"""Admin: invitations and roles, task generation, expired-claim resets,
review batches and payouts (ADR D9, D14)."""

import secrets
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from mt_sim import load_templates, sample_params
from psycopg.errors import UniqueViolation
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field, field_validator

from ..config import Settings
from ..db import Database, content_hash
from ..deps import ROLES, USER_COLUMNS, User, get_db, get_settings, require, user_from_row
from ..points import PointsRuleError, check_payout_transition, payout_release
from .annotator import AVAILABLE_TASKS_SQL, expire_claims, payout_out
from .auth import create_invite

router = APIRouter(prefix="/api/admin", tags=["admin"])
admin_only = require("admin")


# --- users and invitations ---------------------------------------------------------


class InviteIn(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    displayName: str = Field(min_length=1, max_length=100)
    roles: list[Literal["annotator", "reviewer", "admin"]] = Field(min_length=1)

    @field_validator("email")
    @classmethod
    def normal_email(cls, v: str) -> str:
        v = v.strip().lower()
        if "@" not in v or v.startswith("@") or v.endswith("@"):
            raise ValueError("Enter a valid email address")
        return v


class UserPatch(BaseModel):
    roles: list[Literal["annotator", "reviewer", "admin"]] | None = Field(default=None, min_length=1)
    active: bool | None = None
    displayName: str | None = Field(default=None, min_length=1, max_length=100)


@router.get("/users")
def list_users(_: User = Depends(admin_only), db: Database = Depends(get_db)) -> dict:
    with db.transaction() as conn:
        rows = conn.execute(
            f"""
            SELECT {USER_COLUMNS}, u.active, u.created_at, u.password_hash IS NOT NULL AS has_password,
                   COALESCE((SELECT SUM(points) FROM points_ledger l WHERE l.user_id = u.id), 0)::int AS balance
            FROM users u ORDER BY u.created_at
            """
        ).fetchall()
    return {
        "users": [
            {
                **user_from_row(r).public(),
                "active": r["active"],
                "hasPassword": r["has_password"],
                "balance": r["balance"],
                "createdAt": r["created_at"].isoformat(),
            }
            for r in rows
        ]
    }


@router.post("/users", status_code=201)
def invite_user(
    body: InviteIn,
    admin: User = Depends(admin_only),
    db: Database = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict:
    roles = sorted(set(body.roles), key=ROLES.index)
    try:
        with db.transaction() as conn:
            row = conn.execute(
                f"""
                INSERT INTO users (email, display_name, roles, invited_by) VALUES (%s, %s, %s::user_role[], %s)
                RETURNING {USER_COLUMNS.replace('u.', '')}
                """,
                (body.email, body.displayName.strip(), roles, admin.id),
            ).fetchone()
            link = create_invite(conn, settings, row["id"], admin.id)
    except UniqueViolation as e:
        raise HTTPException(409, "Someone with that email already has an account") from e
    return {"user": user_from_row(row).public(), "inviteUrl": link}


@router.post("/users/{user_id}/invite")
def reissue_invite(
    user_id: str,
    admin: User = Depends(admin_only),
    db: Database = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict:
    """A fresh one-time link. Also serves as a password reset."""
    with db.transaction() as conn:
        exists = conn.execute("SELECT 1 FROM users WHERE id = %s AND active", (user_id,)).fetchone()
        if not exists:
            raise HTTPException(404, "No active user with that id")
        link = create_invite(conn, settings, user_id, admin.id)
    return {"inviteUrl": link}


@router.patch("/users/{user_id}")
def update_user(
    user_id: str, body: UserPatch, admin: User = Depends(admin_only), db: Database = Depends(get_db)
) -> dict:
    if user_id == admin.id:
        if body.active is False:
            raise HTTPException(422, "You can't deactivate your own account")
        if body.roles is not None and "admin" not in body.roles:
            raise HTTPException(422, "You can't remove your own admin role")
    with db.transaction() as conn:
        if body.roles is not None:
            roles = sorted(set(body.roles), key=ROLES.index)
            conn.execute("UPDATE users SET roles = %s::user_role[] WHERE id = %s", (roles, user_id))
        if body.active is not None:
            conn.execute("UPDATE users SET active = %s WHERE id = %s", (body.active, user_id))
            if not body.active:
                conn.execute("DELETE FROM sessions WHERE user_id = %s", (user_id,))
        if body.displayName is not None:
            conn.execute("UPDATE users SET display_name = %s WHERE id = %s", (body.displayName.strip(), user_id))
        row = conn.execute(f"SELECT {USER_COLUMNS}, u.active FROM users u WHERE u.id = %s", (user_id,)).fetchone()
    if row is None:
        raise HTTPException(404, "No user with that id")
    return {"user": {**user_from_row(row).public(), "active": row["active"]}}


# --- overview and task generation -----------------------------------------------------


@router.get("/overview")
def overview(_: User = Depends(admin_only), db: Database = Depends(get_db)) -> dict:
    with db.transaction() as conn:
        expire_claims(conn)
        t = conn.execute(
            """
            SELECT
              (SELECT count(*) FROM tasks)::int AS tasks,
              (SELECT count(*) FROM assignments WHERE status = 'claimed')::int AS claimed,
              (SELECT count(*) FROM assignments WHERE status = 'expired')::int AS expired,
              (SELECT count(*) FROM submissions s WHERE NOT EXISTS
                 (SELECT 1 FROM replay_results rr WHERE rr.submission_id = s.id))::int AS awaiting_replay,
              (SELECT count(*) FROM submissions s
                 WHERE EXISTS (SELECT 1 FROM replay_results rr WHERE rr.submission_id = s.id)
                   AND NOT EXISTS (SELECT 1 FROM review_batch_items bi WHERE bi.submission_id = s.id)
                   AND NOT EXISTS (SELECT 1 FROM reviews r WHERE r.submission_id = s.id))::int AS unassigned,
              (SELECT count(*) FROM review_batch_items bi
                 WHERE NOT EXISTS (SELECT 1 FROM reviews r WHERE r.submission_id = bi.submission_id))::int
                 AS awaiting_review,
              (SELECT count(*) FROM reviews WHERE verdict = 'accepted')::int AS accepted,
              (SELECT count(*) FROM reviews WHERE verdict = 'rejected')::int AS rejected,
              (SELECT count(*) FROM payout_requests WHERE status IN ('requested', 'contacted'))::int AS open_payouts
            """
        ).fetchone()
        per_template = conn.execute(
            """
            SELECT i.template_id, count(t.id)::int AS tasks,
                   count(r.id) FILTER (WHERE r.verdict = 'accepted')::int AS accepted
            FROM tasks t JOIN scenario_instances i ON i.id = t.instance_id
            LEFT JOIN assignments a ON a.task_id = t.id
            LEFT JOIN submissions s ON s.assignment_id = a.id
            LEFT JOIN reviews r ON r.submission_id = s.id
            GROUP BY i.template_id ORDER BY i.template_id
            """
        ).fetchall()
        available = conn.execute(f"SELECT count(*)::int AS n FROM ({AVAILABLE_TASKS_SQL}) x").fetchone()["n"]
    return {
        "tasks": {"total": t["tasks"], "available": available, "claimed": t["claimed"], "expired": t["expired"]},
        "submissions": {
            "awaitingReplay": t["awaiting_replay"],
            "unassigned": t["unassigned"],
            "awaitingReview": t["awaiting_review"],
            "accepted": t["accepted"],
            "rejected": t["rejected"],
        },
        "openPayouts": t["open_payouts"],
        "templates": [
            {"templateId": r["template_id"], "tasks": r["tasks"], "accepted": r["accepted"]} for r in per_template
        ],
    }


class GenerateIn(BaseModel):
    templateId: str
    count: int | None = Field(default=None, ge=1, le=500)
    # Specific seeds instead of random ones, e.g. to reproduce a scenario or build gold tasks.
    seeds: list[int] | None = Field(default=None, min_length=1, max_length=500)


@router.post("/tasks/generate", status_code=201)
def generate_tasks(body: GenerateIn, _: User = Depends(admin_only), db: Database = Depends(get_db)) -> dict:
    template = load_templates().get(body.templateId)
    if template is None:
        raise HTTPException(422, f"Unknown scenario template {body.templateId}")
    if (body.count is None) == (body.seeds is None):
        raise HTTPException(422, "Give either count or seeds")
    if body.seeds is not None and any(s < 0 or s >= 2**32 for s in body.seeds):
        raise HTTPException(422, "Seeds must be between 0 and 4294967295")
    seeds = body.seeds if body.seeds is not None else [secrets.randbelow(2**31) for _ in range(body.count or 0)]
    created = 0
    with db.transaction() as conn:
        for seed in seeds:
            params = sample_params(template, seed)
            h = content_hash(template["templateId"], template["schemaVersion"], seed, params)
            inst = conn.execute(
                """
                INSERT INTO scenario_instances (template_id, schema_version, seed, params, content_hash)
                VALUES (%s, %s, %s, %s, %s) ON CONFLICT (content_hash) DO NOTHING RETURNING id
                """,
                (template["templateId"], template["schemaVersion"], seed, Jsonb(params), h),
            ).fetchone()
            if inst is None:
                continue
            conn.execute("INSERT INTO tasks (instance_id) VALUES (%s)", (inst["id"],))
            created += 1
    return {"created": created}


# --- claims -----------------------------------------------------------------------------


class ResetIn(BaseModel):
    assignmentIds: list[str] = Field(min_length=1, max_length=1000)


@router.get("/claims")
def list_claims(
    status: Literal["expired", "claimed"] = "expired", _: User = Depends(admin_only), db: Database = Depends(get_db)
) -> dict:
    with db.transaction() as conn:
        expire_claims(conn)
        rows = conn.execute(
            """
            SELECT a.id, a.claimed_at, a.expires_at, u.display_name, u.email, i.template_id, i.seed
            FROM assignments a JOIN users u ON u.id = a.annotator_id
            JOIN tasks t ON t.id = a.task_id JOIN scenario_instances i ON i.id = t.instance_id
            WHERE a.status = %s ORDER BY a.expires_at
            """,
            (status,),
        ).fetchall()
    return {
        "claims": [
            {
                "id": str(r["id"]),
                "annotator": r["display_name"],
                "annotatorEmail": r["email"],
                "templateId": r["template_id"],
                "seed": r["seed"],
                "claimedAt": r["claimed_at"].isoformat(),
                "expiresAt": r["expires_at"].isoformat(),
            }
            for r in rows
        ]
    }


@router.post("/claims/reset")
def reset_claims(body: ResetIn, admin: User = Depends(admin_only), db: Database = Depends(get_db)) -> dict:
    with db.transaction() as conn:
        expire_claims(conn)
        n = conn.execute(
            """
            UPDATE assignments SET status = 'reset', reset_by_admin_id = %s
            WHERE status = 'expired' AND id = ANY(%s::uuid[])
            """,
            (admin.id, body.assignmentIds),
        ).rowcount
    return {"reset": n}


# --- review batches --------------------------------------------------------------------


UNASSIGNED_SQL = """
    SELECT s.id, s.created_at, s.outcome::text AS outcome, a.annotator_id, i.template_id,
           rr.valid, rr.flags
    FROM submissions s
    JOIN assignments a ON a.id = s.assignment_id
    JOIN tasks t ON t.id = a.task_id
    JOIN scenario_instances i ON i.id = t.instance_id
    JOIN replay_results rr ON rr.submission_id = s.id
    WHERE NOT EXISTS (SELECT 1 FROM review_batch_items bi WHERE bi.submission_id = s.id)
      AND NOT EXISTS (SELECT 1 FROM reviews r WHERE r.submission_id = s.id)
"""


@router.get("/submissions/unassigned")
def unassigned_submissions(_: User = Depends(admin_only), db: Database = Depends(get_db)) -> dict:
    with db.transaction() as conn:
        rows = conn.execute(UNASSIGNED_SQL + " ORDER BY s.created_at").fetchall()
    return {
        "submissions": [
            {
                "id": str(r["id"]),
                "submittedAt": r["created_at"].isoformat(),
                "outcome": r["outcome"],
                "annotatorId": str(r["annotator_id"]),
                "templateId": r["template_id"],
                "valid": r["valid"],
                "flags": r["flags"] or [],
            }
            for r in rows
        ]
    }


class BatchIn(BaseModel):
    reviewerId: str
    submissionIds: list[str] | None = Field(default=None, min_length=1, max_length=500)
    count: int | None = Field(default=None, ge=1, le=500)


@router.post("/review-batches", status_code=201)
def create_batch(body: BatchIn, admin: User = Depends(admin_only), db: Database = Depends(get_db)) -> dict:
    if (body.submissionIds is None) == (body.count is None):
        raise HTTPException(422, "Give either submissionIds or count")
    with db.transaction() as conn:
        reviewer = conn.execute(
            "SELECT id FROM users WHERE id = %s AND active AND 'reviewer' = ANY(roles)", (body.reviewerId,)
        ).fetchone()
        if reviewer is None:
            raise HTTPException(422, "That user isn't an active reviewer")
        # Lock candidate rows so two admins can't put one submission in two batches.
        if body.submissionIds is not None:
            rows = conn.execute(
                UNASSIGNED_SQL + " AND s.id = ANY(%s::uuid[]) FOR UPDATE OF s", (body.submissionIds,)
            ).fetchall()
            found = {str(r["id"]) for r in rows}
            missing = [s for s in body.submissionIds if s not in found]
            if missing:
                raise HTTPException(422, f"{len(missing)} submission(s) are not awaiting assignment")
        else:
            rows = conn.execute(
                UNASSIGNED_SQL + " AND a.annotator_id <> %s ORDER BY s.created_at LIMIT %s FOR UPDATE OF s SKIP LOCKED",
                (body.reviewerId, body.count),
            ).fetchall()
        if any(str(r["annotator_id"]) == body.reviewerId for r in rows):
            raise HTTPException(422, "A reviewer can't be given their own submissions")
        if not rows:
            raise HTTPException(404, "No submissions are waiting for a reviewer")
        batch_id = conn.execute(
            "INSERT INTO review_batches (reviewer_id, assigned_by) VALUES (%s, %s) RETURNING id",
            (body.reviewerId, admin.id),
        ).fetchone()["id"]
        for r in rows:
            conn.execute(
                "INSERT INTO review_batch_items (batch_id, submission_id) VALUES (%s, %s)", (batch_id, r["id"])
            )
    return {"batchId": str(batch_id), "size": len(rows)}


@router.get("/review-batches")
def list_batches(_: User = Depends(admin_only), db: Database = Depends(get_db)) -> dict:
    with db.transaction() as conn:
        rows = conn.execute(
            """
            SELECT b.id, b.created_at, u.display_name AS reviewer,
                   count(bi.submission_id)::int AS size, count(r.id)::int AS done
            FROM review_batches b JOIN users u ON u.id = b.reviewer_id
            LEFT JOIN review_batch_items bi ON bi.batch_id = b.id
            LEFT JOIN reviews r ON r.submission_id = bi.submission_id
            GROUP BY b.id, u.display_name ORDER BY b.created_at DESC LIMIT 200
            """
        ).fetchall()
    return {
        "batches": [
            {
                "id": str(r["id"]),
                "reviewer": r["reviewer"],
                "createdAt": r["created_at"].isoformat(),
                "size": r["size"],
                "done": r["done"],
            }
            for r in rows
        ]
    }


# --- payouts -----------------------------------------------------------------------------


class PayoutUpdate(BaseModel):
    status: Literal["contacted", "paid", "cancelled"]
    externalReference: str | None = Field(default=None, max_length=200)


@router.get("/payouts")
def list_payouts(
    status: Literal["open", "all"] = "open", _: User = Depends(admin_only), db: Database = Depends(get_db)
) -> dict:
    where = "WHERE p.status IN ('requested', 'contacted')" if status == "open" else ""
    with db.transaction() as conn:
        rows = conn.execute(
            f"""
            SELECT p.*, p.status::text AS status, u.display_name, u.email
            FROM payout_requests p JOIN users u ON u.id = p.user_id
            {where} ORDER BY p.created_at
            """
        ).fetchall()
    return {"payouts": [{**payout_out(r), "user": r["display_name"], "email": r["email"]} for r in rows]}


@router.post("/payouts/{payout_id}")
def update_payout(
    payout_id: str, body: PayoutUpdate, admin: User = Depends(admin_only), db: Database = Depends(get_db)
) -> dict:
    with db.transaction() as conn:
        p = conn.execute(
            "SELECT *, status::text AS status FROM payout_requests WHERE id = %s FOR UPDATE", (payout_id,)
        ).fetchone()
        if p is None:
            raise HTTPException(404, "No payout request with that id")
        try:
            check_payout_transition(p["status"], body.status, body.externalReference)
        except PointsRuleError as e:
            raise HTTPException(409, str(e)) from e
        if body.status == "paid":
            conn.execute(
                """
                UPDATE payout_requests SET status = 'paid', admin_id = %s, paid_at = now(), external_reference = %s
                WHERE id = %s
                """,
                (admin.id, body.externalReference.strip(), payout_id),
            )
        else:
            conn.execute(
                "UPDATE payout_requests SET status = %s, admin_id = %s WHERE id = %s",
                (body.status, admin.id, payout_id),
            )
        if body.status == "cancelled":
            rel = payout_release(p["points"])
            conn.execute(
                "INSERT INTO points_ledger (user_id, entry_type, points, payout_id, note) VALUES (%s, %s, %s, %s, %s)",
                (p["user_id"], rel.entry_type, rel.points, payout_id, "Payout cancelled; points returned"),
            )
        row = conn.execute(
            """
            SELECT p.*, p.status::text AS status, u.display_name, u.email
            FROM payout_requests p JOIN users u ON u.id = p.user_id WHERE p.id = %s
            """,
            (payout_id,),
        ).fetchone()
    return {"payout": {**payout_out(row), "user": row["display_name"], "email": row["email"]}}
