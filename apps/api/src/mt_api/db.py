"""Postgres access: a connection pool, explicit transactions and migrations."""

import hashlib
import json
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

from mt_sim import load_templates
from psycopg import Connection
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

MIGRATIONS_DIR = Path(__file__).resolve().parents[2] / "migrations"


class Database:
    def __init__(self, url: str, max_size: int = 10) -> None:
        self.pool = ConnectionPool(
            url,
            min_size=1,
            max_size=max_size,
            kwargs={"row_factory": dict_row, "autocommit": False},
            open=True,
        )

    @contextmanager
    def transaction(self) -> Iterator[Connection]:
        """Commits when the block ends, rolls back if it raises."""
        with self.pool.connection() as conn:
            yield conn

    def close(self) -> None:
        self.pool.close()


def migrate(conn: Connection) -> list[str]:
    """Applies migrations/*.sql in name order, each once. Returns those applied."""
    conn.execute(
        "CREATE TABLE IF NOT EXISTS schema_migrations ("
        " name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"
    )
    done = {r["name"] for r in conn.execute("SELECT name FROM schema_migrations").fetchall()}
    applied = []
    for f in sorted(MIGRATIONS_DIR.glob("*.sql")):
        if f.name in done:
            continue
        conn.execute(f.read_text())
        conn.execute("INSERT INTO schema_migrations (name) VALUES (%s)", (f.name,))
        applied.append(f.name)
    return applied


def sync_templates(conn: Connection) -> int:
    """Copies packages/scenarios templates into scenario_templates (upsert)."""
    templates = load_templates()
    for t in templates.values():
        conn.execute(
            """
            INSERT INTO scenario_templates (id, schema_version, family, difficulty_tier, body)
            VALUES (%s, %s, %s, %s, %s)
            ON CONFLICT (id, schema_version)
            DO UPDATE SET family = EXCLUDED.family, difficulty_tier = EXCLUDED.difficulty_tier, body = EXCLUDED.body
            """,
            (t["templateId"], t["schemaVersion"], t["family"], t["difficultyTier"], json.dumps(t)),
        )
    return len(templates)


def content_hash(template_id: str, schema_version: str, seed: int, params: dict) -> str:
    payload = json.dumps([template_id, schema_version, seed, params], sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode()).hexdigest()
