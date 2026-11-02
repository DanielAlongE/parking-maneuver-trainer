"""Annotator workflow: claim a task (24-hour window), submit, see results,
points and payout requests (ADR D9, D13, D14)."""

from typing import Annotated, Literal, Union

from fastapi import APIRouter, Depends, HTTPException
from psycopg import Connection
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from ..db import Database
from ..deps import User, current_user, get_db, get_queue, require
from ..points import MIN_PAYOUT_POINTS, PointsRuleError, balance_sql, cash_amount_usd, payout_hold
from ..replay_queue import ReplayQueue

router = APIRouter(prefix="/api", tags=["annotator"])


class DriveSegment(BaseModel):
    kind: Literal["drive"]
    gear: Literal["D", "R"]
    steerDeg: float = Field(ge=-90, le=90)
    distanceM: float = Field(ge=0, le=100)
    speedMps: float = Field(gt=0, le=20)


class WaitSegment(BaseModel):
    kind: Literal["wait"]
    durationS: float = Field(ge=0, le=120)


Segment = Annotated[Union[DriveSegment, WaitSegment], Field(discriminator="kind")]


class SubmissionIn(BaseModel):
    simVersion: str = Field(max_length=32)
    outcome: Literal["plan", "unreachable"]
    actions: list[Segment] = Field(default_factory=list, max_length=30)
    reasonCode: Literal["no_gap", "blocked_by_agent", "rule_violation_required", "other"] | None = None
    confidence: int = Field(ge=1, le=5)
    notes: str = Field(default="", max_length=2000)
    attempts: int = Field(default=0, ge=0, le=100000)
    clientResult: dict | None = None


class PayoutIn(BaseModel):
    points: int = Field(ge=MIN_PAYOUT_POINTS)


def expire_claims(conn: Connection) -> None:
    """Claims past their 24-hour window become expired; an admin resets them."""
    conn.execute("UPDATE assignments SET status = 'expired' WHERE status = 'claimed' AND expires_at <= now()")


ASSIGNMENT_SQL = """
    SELECT a.id, a.status::text AS status, a.claimed_at, a.expires_at,
           t.id AS task_id, t.default_points, i.template_id, i.seed, st.difficulty_tier
    FROM assignments a
    JOIN tasks t ON t.id = a.task_id
    JOIN scenario_instances i ON i.id = t.instance_id
    JOIN scenario_templates st ON st.id = i.template_id AND st.schema_version = i.schema_version
"""


def assignment_out(row: dict) -> dict:
    return {
        "id": str(row["id"]),
        "status": row["status"],
        "taskId": str(row["task_id"]),
        "templateId": row["template_id"],
        "seed": row["seed"],
        "difficultyTier": row["difficulty_tier"],
        "defaultPoints": row["default_points"],
        "claimedAt": row["claimed_at"].isoformat(),
        "expiresAt": row["expires_at"].isoformat(),
    }


def open_claim(conn: Connection, user_id: str) -> dict | None:
    return conn.execute(f"{ASSIGNMENT_SQL} WHERE a.annotator_id = %s AND a.status = 'claimed'", (user_id,)).fetchone()


# A task is free when nobody holds it, it is not waiting for an admin reset,
# and it has no submission that is pending or accepted. A rejected task goes
# back to the queue for other annotators.
AVAILABLE_TASKS_SQL = """
    SELECT t.id FROM tasks t
    WHERE NOT EXISTS (
        SELECT 1 FROM assignments a
        WHERE a.task_id = t.id AND (
            a.status IN ('claimed', 'expired')
            OR (a.status = 'submitted' AND NOT EXISTS (
                SELECT 1 FROM submissions s JOIN reviews r ON r.submission_id = s.id
                WHERE s.assignment_id = a.id AND r.verdict = 'rejected'))
        )
    )
"""


@router.get("/assignments/current")
def current_assignment(user: User = Depends(require("annotator")), db: Database = Depends(get_db)) -> dict:
    with db.transaction() as conn:
        expire_claims(conn)
        row = open_claim(conn, user.id)
    return {"assignment": assignment_out(row) if row else None}


@router.post("/tasks/claim")
def claim_task(user: User = Depends(require("annotator")), db: Database = Depends(get_db)) -> dict:
    with db.transaction() as conn:
        expire_claims(conn)
        existing = open_claim(conn, user.id)
        if existing:
            return {"assignment": assignment_out(existing)}
        task = conn.execute(
            AVAILABLE_TASKS_SQL
            + """
            AND NOT EXISTS (SELECT 1 FROM assignments a2 WHERE a2.task_id = t.id AND a2.annotator_id = %s)
            ORDER BY t.created_at, t.id
            LIMIT 1
            FOR UPDATE SKIP LOCKED
            """,
            (user.id,),
        ).fetchone()
        if task is None:
            raise HTTPException(404, "No tasks are available right now; check back later")
        aid = conn.execute(
            "INSERT INTO assignments (task_id, annotator_id) VALUES (%s, %s) RETURNING id", (task["id"], user.id)
        ).fetchone()["id"]
        row = conn.execute(f"{ASSIGNMENT_SQL} WHERE a.id = %s", (aid,)).fetchone()
    return {"assignment": assignment_out(row)}


@router.post("/assignments/{assignment_id}/submit", status_code=201)
def submit(
    assignment_id: str,
    body: SubmissionIn,
    user: User = Depends(require("annotator")),
    db: Database = Depends(get_db),
    queue: ReplayQueue = Depends(get_queue),
) -> dict:
    if body.outcome == "plan" and not body.actions:
        raise HTTPException(422, "A plan needs at least one move")
    if body.outcome == "unreachable" and body.reasonCode is None:
        raise HTTPException(422, "Say why the goal can't be reached safely")
    with db.transaction() as conn:
        expire_claims(conn)
        a = conn.execute(
            "SELECT annotator_id, status::text AS status FROM assignments WHERE id = %s FOR UPDATE",
            (assignment_id,),
        ).fetchone()
        if a is None or str(a["annotator_id"]) != user.id:
            raise HTTPException(404, "Task not found")
        if a["status"] == "expired":
            raise HTTPException(409, "Your 24 hours on this task ran out, so it can no longer be submitted")
        if a["status"] != "claimed":
            raise HTTPException(409, "This task was already submitted")
        sid = conn.execute(
            """
            INSERT INTO submissions
                (assignment_id, sim_version, outcome, actions, reason_code, confidence, notes, client_result)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                assignment_id,
                body.simVersion,
                body.outcome,
                Jsonb([s.model_dump() for s in body.actions] if body.outcome == "plan" else []),
                body.reasonCode if body.outcome == "unreachable" else None,
                body.confidence,
                body.notes.strip(),
                Jsonb(body.clientResult) if body.clientResult is not None else None,
            ),
        ).fetchone()["id"]
        conn.execute(
            "UPDATE assignments SET status = 'submitted', finished_at = now(), attempts = %s WHERE id = %s",
            (body.attempts, assignment_id),
        )
    queue.enqueue(str(sid))
    return {"id": str(sid), "status": "pending_replay"}


SUBMISSION_STATUS_SQL = """
    CASE WHEN r.verdict IS NOT NULL THEN r.verdict::text
         WHEN rr.submission_id IS NOT NULL THEN 'pending_review'
         ELSE 'pending_replay' END
"""


@router.get("/me/submissions")
def my_submissions(user: User = Depends(require("annotator")), db: Database = Depends(get_db)) -> dict:
    with db.transaction() as conn:
        rows = conn.execute(
            f"""
            SELECT s.id, s.created_at, s.outcome::text AS outcome, i.template_id, i.seed,
                   rr.goal_reached, rr.collision, {SUBMISSION_STATUS_SQL} AS status,
                   r.points_set, r.comment
            FROM submissions s
            JOIN assignments a ON a.id = s.assignment_id
            JOIN tasks t ON t.id = a.task_id
            JOIN scenario_instances i ON i.id = t.instance_id
            LEFT JOIN replay_results rr ON rr.submission_id = s.id
            LEFT JOIN reviews r ON r.submission_id = s.id
            WHERE a.annotator_id = %s
            ORDER BY s.created_at DESC
            LIMIT 200
            """,
            (user.id,),
        ).fetchall()
    return {
        "submissions": [
            {
                "id": str(r["id"]),
                "submittedAt": r["created_at"].isoformat(),
                "templateId": r["template_id"],
                "seed": r["seed"],
                "outcome": r["outcome"],
                "status": r["status"],
                "goalReached": r["goal_reached"],
                "collision": r["collision"],
                "pointsAwarded": r["points_set"] if r["status"] == "accepted" else None,
                "reviewerComment": r["comment"] or None,
            }
            for r in rows
        ]
    }


def payout_out(r: dict) -> dict:
    return {
        "id": str(r["id"]),
        "points": r["points"],
        "cashAmountUsd": f"{r['cash_amount_usd']:.2f}",
        "status": r["status"],
        "requestedAt": r["created_at"].isoformat(),
        "paidAt": r["paid_at"].isoformat() if r["paid_at"] else None,
        "externalReference": r["external_reference"],
    }


@router.get("/me/points")
def my_points(user: User = Depends(current_user), db: Database = Depends(get_db)) -> dict:
    with db.transaction() as conn:
        bal = conn.execute(balance_sql(), (user.id,)).fetchone()["balance"]
        entries = conn.execute(
            """
            SELECT id, entry_type::text AS entry_type, points, note, created_at
            FROM points_ledger WHERE user_id = %s ORDER BY id DESC LIMIT 200
            """,
            (user.id,),
        ).fetchall()
        payouts = conn.execute(
            "SELECT *, status::text AS status FROM payout_requests WHERE user_id = %s ORDER BY created_at DESC",
            (user.id,),
        ).fetchall()
    return {
        "balance": bal,
        "balanceUsd": f"{cash_amount_usd(max(bal, 0)):.2f}",
        "minPayoutPoints": MIN_PAYOUT_POINTS,
        "entries": [
            {
                "id": e["id"],
                "type": e["entry_type"],
                "points": e["points"],
                "note": e["note"],
                "at": e["created_at"].isoformat(),
            }
            for e in entries
        ],
        "payouts": [payout_out(p) for p in payouts],
    }


@router.post("/me/payouts", status_code=201)
def request_payout(body: PayoutIn, user: User = Depends(current_user), db: Database = Depends(get_db)) -> dict:
    with db.transaction() as conn:
        # Lock the user so two requests cannot spend the same points.
        conn.execute("SELECT id FROM users WHERE id = %s FOR UPDATE", (user.id,))
        bal = conn.execute(balance_sql(), (user.id,)).fetchone()["balance"]
        try:
            hold = payout_hold(bal, body.points)
        except PointsRuleError as e:
            raise HTTPException(422, str(e)) from e
        row = conn.execute(
            """
            INSERT INTO payout_requests (user_id, points, cash_amount_usd) VALUES (%s, %s, %s)
            RETURNING *, status::text AS status
            """,
            (user.id, body.points, cash_amount_usd(body.points)),
        ).fetchone()
        conn.execute(
            "INSERT INTO points_ledger (user_id, entry_type, points, payout_id, note) VALUES (%s, %s, %s, %s, %s)",
            (user.id, hold.entry_type, hold.points, row["id"], "Payout requested"),
        )
    return {"payout": payout_out(row)}

