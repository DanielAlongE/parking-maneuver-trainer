"""Command-line tools.

  uv run python -m mt_api.cli migrate
  uv run python -m mt_api.cli create-admin --email you@example.com --name "Your Name"

create-admin prints a one-time link where the first admin sets a password.
"""

import argparse
import sys

from .config import load_settings
from .db import Database, migrate, sync_templates
from .routes.auth import create_invite


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="mt_api.cli")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("migrate", help="apply database migrations and sync scenario templates")
    ca = sub.add_parser("create-admin", help="create an admin account and print its invite link")
    ca.add_argument("--email", required=True)
    ca.add_argument("--name", required=True)
    ca.add_argument("--roles", default="admin,reviewer,annotator", help="comma-separated roles")
    args = parser.parse_args(argv)

    settings = load_settings()
    db = Database(settings.database_url, max_size=1)
    try:
        with db.transaction() as conn:
            applied = migrate(conn)
            n = sync_templates(conn)
        if args.command == "migrate":
            print(f"migrations applied: {', '.join(applied) or 'none (up to date)'}; templates synced: {n}")
            return 0
        roles = [r.strip() for r in args.roles.split(",") if r.strip()]
        if "admin" not in roles:
            print("create-admin needs the admin role", file=sys.stderr)
            return 2
        with db.transaction() as conn:
            row = conn.execute(
                """
                INSERT INTO users (email, display_name, roles) VALUES (%s, %s, %s::user_role[])
                ON CONFLICT (email) DO UPDATE SET roles = EXCLUDED.roles, active = true
                RETURNING id
                """,
                (args.email.strip().lower(), args.name.strip(), roles),
            ).fetchone()
            link = create_invite(conn, settings, row["id"], None)
        print(f"Admin {args.email} ready. Open this link to set a password (valid {settings.invite_days} days):")
        print(link)
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    sys.exit(main())
