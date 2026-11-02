"""API test fixtures. Integration tests need a throwaway Postgres database:

    TEST_DATABASE_URL=postgresql://postgres@localhost:5432/mt_test uv run pytest

Its public schema is dropped and rebuilt at the start of the run.
"""

import os
from dataclasses import dataclass, field

import psycopg
import pytest
from fastapi.testclient import TestClient

from mt_api.config import Settings
from mt_api.main import create_app
from mt_api.replay_queue import MemoryReplayQueue
from mt_api.security import hash_password

TEST_DB = os.environ.get("TEST_DATABASE_URL")
needs_db = pytest.mark.skipif(not TEST_DB, reason="set TEST_DATABASE_URL to run integration tests")

TABLES = (
    "users, invites, sessions, scenario_instances, candidate_plans, tasks, assignments, submissions, "
    "replay_results, rankings, review_batches, review_batch_items, reviews, points_ledger, payout_requests, "
    "dataset_snapshots"
)
PASSWORD = "correct horse battery"


@pytest.fixture(scope="session")
def _fresh_schema() -> None:
    with psycopg.connect(TEST_DB, autocommit=True) as conn:
        conn.execute("DROP SCHEMA public CASCADE")
        conn.execute("CREATE SCHEMA public")


@dataclass
class Env:
    app: object
    queue: MemoryReplayQueue
    admin: TestClient
    clients: list = field(default_factory=list)

    def sql(self, query: str, params: tuple = ()) -> list[dict]:
        with self.app.state.db.transaction() as conn:
            cur = conn.execute(query, params)
            return cur.fetchall() if cur.description else []

    def client(self) -> TestClient:
        c = TestClient(self.app)
        self.clients.append(c)
        return c

    def invite(self, email: str, roles: list[str], name: str | None = None) -> TestClient:
        """Invites a user through the admin API, accepts it, returns their signed-in client."""
        res = self.admin.post(
            "/api/admin/users", json={"email": email, "displayName": name or email.split("@")[0], "roles": roles}
        )
        assert res.status_code == 201, res.text
        token = res.json()["inviteUrl"].rsplit("/", 1)[1]
        c = self.client()
        res = c.post(f"/api/auth/invites/{token}/accept", json={"password": PASSWORD})
        assert res.status_code == 200, res.text
        return c

    def user_id(self, client: TestClient) -> str:
        return client.get("/api/auth/me").json()["user"]["id"]

    def fake_replay(self, submission_id: str, valid: bool = True) -> None:
        """What apps/replay-worker writes, for tests that don't run the worker."""
        self.sql(
            """
            INSERT INTO replay_results (submission_id, sim_version, valid, goal_reached, collision,
                final_position_error_m, final_heading_error_deg, min_clearance_static_m, min_clearance_agents_m,
                direction_changes, duration_s, steering_smoothness, client_mismatch, flags)
            VALUES (%s, '0.1.0', %s, %s, NULL, 0.2, 4.5, 0.07, NULL, 1, 21.2, 6.6, false, '{}')
            """,
            (submission_id, valid, valid),
        )


@pytest.fixture
def env(_fresh_schema):
    queue = MemoryReplayQueue()
    settings = Settings(database_url=TEST_DB, redis_url="redis://unused", public_url="http://web.test", cookie_secure=False)
    app = create_app(settings, queue)
    with TestClient(app) as admin:
        with app.state.db.transaction() as conn:
            conn.execute(f"TRUNCATE {TABLES} RESTART IDENTITY CASCADE")
            conn.execute(
                "INSERT INTO users (email, display_name, roles, password_hash) VALUES (%s, %s, %s::user_role[], %s)",
                ("admin@test", "Admin", ["admin", "reviewer"], hash_password(PASSWORD)),
            )
        assert admin.post("/api/auth/login", json={"email": "admin@test", "password": PASSWORD}).status_code == 200
        e = Env(app=app, queue=queue, admin=admin)
        yield e
        for c in e.clients:
            c.close()


PLAN = {
    "simVersion": "0.1.0",
    "outcome": "plan",
    "actions": [
        {"kind": "drive", "gear": "R", "steerDeg": 0, "distanceM": 1, "speedMps": 1},
        {"kind": "drive", "gear": "R", "steerDeg": -35, "distanceM": 2.75, "speedMps": 0.3},
    ],
    "confidence": 4,
    "attempts": 3,
    "clientResult": {"goalReached": True},
}
