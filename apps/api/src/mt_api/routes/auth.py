"""Email + password sign-in. Accounts exist only through admin invitations."""

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from psycopg import Connection
from pydantic import BaseModel, Field

from ..config import Settings
from ..db import Database
from ..deps import SESSION_COOKIE, User, current_user, get_db, get_settings, load_user
from ..security import DUMMY_HASH, MIN_PASSWORD_LENGTH, hash_password, new_token, token_hash, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginIn(BaseModel):
    email: str = Field(max_length=320)
    password: str = Field(max_length=200)


class AcceptInviteIn(BaseModel):
    password: str = Field(min_length=MIN_PASSWORD_LENGTH, max_length=200)


def start_session(conn: Connection, response: Response, settings: Settings, user_id: str) -> None:
    token, hashed = new_token()
    conn.execute(
        "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (%s, %s, now() + make_interval(days => %s))",
        (hashed, user_id, settings.session_days),
    )
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=settings.session_days * 86400,
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
        path="/",
    )


@router.post("/login")
def login(
    body: LoginIn, response: Response, db: Database = Depends(get_db), settings: Settings = Depends(get_settings)
) -> dict:
    email = body.email.strip().lower()
    with db.transaction() as conn:
        row = conn.execute("SELECT id, password_hash, active FROM users WHERE email = %s", (email,)).fetchone()
        stored = row["password_hash"] if row and row["password_hash"] else DUMMY_HASH
        ok = verify_password(body.password, stored) and row is not None and row["active"] and row["password_hash"]
        if not ok:
            raise HTTPException(401, "Email or password is incorrect")
        start_session(conn, response, settings, row["id"])
        user = load_user(conn, row["id"])
    return {"user": user.public()}


@router.post("/logout")
def logout(request: Request, response: Response, db: Database = Depends(get_db)) -> dict:
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        with db.transaction() as conn:
            conn.execute("DELETE FROM sessions WHERE token_hash = %s", (token_hash(token),))
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"ok": True}


@router.get("/me")
def me(user: User = Depends(current_user)) -> dict:
    return {"user": user.public()}


def _open_invite(conn: Connection, token: str) -> dict | None:
    return conn.execute(
        """
        SELECT i.user_id, u.email, u.display_name
        FROM invites i JOIN users u ON u.id = i.user_id
        WHERE i.token_hash = %s AND i.used_at IS NULL AND i.expires_at > now() AND u.active
        """,
        (token_hash(token),),
    ).fetchone()


@router.get("/invites/{token}")
def get_invite(token: str, db: Database = Depends(get_db)) -> dict:
    with db.transaction() as conn:
        row = _open_invite(conn, token)
    if row is None:
        raise HTTPException(404, "This invite link is invalid or has expired; ask an admin for a new one")
    return {"email": row["email"], "displayName": row["display_name"]}


@router.post("/invites/{token}/accept")
def accept_invite(
    token: str,
    body: AcceptInviteIn,
    response: Response,
    db: Database = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict:
    with db.transaction() as conn:
        row = _open_invite(conn, token)
        if row is None:
            raise HTTPException(404, "This invite link is invalid or has expired; ask an admin for a new one")
        user_id = row["user_id"]
        conn.execute("UPDATE users SET password_hash = %s WHERE id = %s", (hash_password(body.password), user_id))
        conn.execute("UPDATE invites SET used_at = now() WHERE token_hash = %s", (token_hash(token),))
        # A new password signs out every other session (invites double as resets).
        conn.execute("DELETE FROM sessions WHERE user_id = %s", (user_id,))
        start_session(conn, response, settings, user_id)
        user = load_user(conn, user_id)
    return {"user": user.public()}


def create_invite(conn: Connection, settings: Settings, user_id: str, created_by: str | None) -> str:
    """Replaces any unused invite for the user and returns the new link."""
    conn.execute("DELETE FROM invites WHERE user_id = %s AND used_at IS NULL", (user_id,))
    token, hashed = new_token()
    conn.execute(
        """
        INSERT INTO invites (token_hash, user_id, created_by, expires_at)
        VALUES (%s, %s, %s, now() + make_interval(days => %s))
        """,
        (hashed, user_id, created_by, settings.invite_days),
    )
    return f"{settings.public_url}/invite/{token}"
