"""Shared request helpers: the database, the signed-in user and role checks."""

from dataclasses import dataclass
from typing import Callable

from fastapi import Depends, HTTPException, Request
from psycopg import Connection

from .config import Settings
from .db import Database
from .replay_queue import ReplayQueue
from .security import token_hash

SESSION_COOKIE = "mt_session"
ROLES = ("annotator", "reviewer", "admin")


@dataclass(frozen=True)
class User:
    id: str
    email: str
    display_name: str
    roles: tuple[str, ...]

    def public(self) -> dict:
        return {"id": self.id, "email": self.email, "displayName": self.display_name, "roles": list(self.roles)}


def get_db(request: Request) -> Database:
    return request.app.state.db


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


def get_queue(request: Request) -> ReplayQueue:
    return request.app.state.queue


USER_COLUMNS = "u.id, u.email, u.display_name, u.roles::text[] AS roles"


def user_from_row(row: dict) -> User:
    return User(str(row["id"]), row["email"], row["display_name"], tuple(row["roles"]))


def load_user(conn: Connection, user_id: str) -> User:
    row = conn.execute(f"SELECT {USER_COLUMNS} FROM users u WHERE u.id = %s", (user_id,)).fetchone()
    return user_from_row(row)


def current_user(request: Request, db: Database = Depends(get_db)) -> User:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        raise HTTPException(401, "Please sign in")
    with db.transaction() as conn:
        row = conn.execute(
            f"""
            SELECT {USER_COLUMNS}
            FROM sessions s JOIN users u ON u.id = s.user_id
            WHERE s.token_hash = %s AND s.expires_at > now() AND u.active
            """,
            (token_hash(token),),
        ).fetchone()
    if row is None:
        raise HTTPException(401, "Your session has ended; please sign in again")
    return user_from_row(row)


def require(role: str) -> Callable[[User], User]:
    def check(user: User = Depends(current_user)) -> User:
        if role not in user.roles:
            raise HTTPException(403, f"This needs the {role} role")
        return user

    return check
