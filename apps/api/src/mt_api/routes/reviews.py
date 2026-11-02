"""Reviewer workflow: the reviewer's assigned queue, the full submission with
its server replay, and the verdict with points (ADR D9, D14)."""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from psycopg import Connection
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from ..db import Database
from ..deps import User, get_db, require
from ..points import MAX_TASK_POINTS, PointsRuleError, review_entries

router = APIRouter(prefix="/api/reviews", tags=["reviews"])

TEMPLATE_TITLES_SQL = "st.body->>'title' AS template_title"


class ReviewIn(BaseModel):
    verdict: Literal["accepted", "rejected"]
    comment: str = Field(default="", max_length=2000)
    pointsSet: int | None = Field(default=None, ge=1, le=MAX_TASK_POINTS)
    pointsReason: str | None = Field(default=None, max_length=500)
    scores: dict[str, int] = Field(default_factory=dict)


@router.get("/queue")
def my_queue(user: User = Depends(require("reviewer")), db: Database = Depends(get_db)) -> dict:
    with db.transaction() as conn:
        rows = conn.execute(
            f"""
            SELECT s.id, s.created_at, s.outcome::text AS outcome, b.id AS batch_id, b.created_at AS assigned_at,
                   i.template_id, {TEMPLATE_TITLES_SQL}, st.difficulty_tier,
                   rr.submission_id IS NOT NULL AS replayed, rr.valid, rr.flags, r.id AS review_id
            FROM review_batch_items bi
            JOIN review_batches b ON b.id = bi.batch_id
            JOIN submissions s ON s.id = bi.submission_id
            JOIN assignments a ON a.id = s.assignment_id
            JOIN tasks t ON t.id = a.task_id
            JOIN scenario_instances i ON i.id = t.instance_id
            JOIN scenario_templates st ON st.id = i.template_id AND st.schema_version = i.schema_version
            LEFT JOIN replay_results rr ON rr.submission_id = s.id
            LEFT JOIN reviews r ON r.submission_id = s.id
            WHERE b.reviewer_id = %s
            ORDER BY b.created_at, s.created_at
            """,
            (user.id,),
        ).fetchall()
    pending = [r for r in rows if r["review_id"] is None]
    return {
        "pending": [
            {
                "submissionId": str(r["id"]),
                "batchId": str(r["batch_id"]),
                "assignedAt": r["assigned_at"].isoformat(),
                "submittedAt": r["created_at"].isoformat(),
                "templateId": r["template_id"],
                "templateTitle": r["template_title"],
                "difficultyTier": r["difficulty_tier"],
                "outcome": r["outcome"],
                "replayed": r["replayed"],
                "valid": r["valid"],
                "flags": r["flags"] or [],
            }
            for r in pending
        ],
        "completedCount": len(rows) - len(pending),
    }


def _load_item(conn: Connection, submission_id: str) -> dict | None:
    return conn.execute(
        f"""
        SELECT s.id, s.created_at, s.outcome::text AS outcome, s.actions, s.reason_code::text AS reason_code,
               s.confidence, s.notes, s.sim_version, a.annotator_id, a.attempts,
               t.default_points, i.template_id, i.seed, {TEMPLATE_TITLES_SQL}, st.difficulty_tier,
               b.reviewer_id,
               rr.valid, rr.goal_reached, rr.collision, rr.final_position_error_m, rr.final_heading_error_deg,
               rr.min_clearance_static_m, rr.min_clearance_agents_m, rr.direction_changes, rr.duration_s,
               rr.steering_smoothness, rr.client_mismatch, rr.flags, rr.sim_version AS replay_sim_version,
               rr.submission_id IS NOT NULL AS replayed,
               r.verdict::text AS verdict, r.comment, r.points_set, r.points_reason, r.created_at AS reviewed_at
        FROM submissions s
        JOIN assignments a ON a.id = s.assignment_id
        JOIN tasks t ON t.id = a.task_id
        JOIN scenario_instances i ON i.id = t.instance_id
        JOIN scenario_templates st ON st.id = i.template_id AND st.schema_version = i.schema_version
        LEFT JOIN review_batch_items bi ON bi.submission_id = s.id
        LEFT JOIN review_batches b ON b.id = bi.batch_id
        LEFT JOIN replay_results rr ON rr.submission_id = s.id
        LEFT JOIN reviews r ON r.submission_id = s.id
        WHERE s.id = %s
        """,
        (submission_id,),
    ).fetchone()


def _can_view(user: User, item: dict) -> bool:
    return "admin" in user.roles or (item["reviewer_id"] is not None and str(item["reviewer_id"]) == user.id)


@router.get("/items/{submission_id}")
def get_item(submission_id: str, user: User = Depends(require("reviewer")), db: Database = Depends(get_db)) -> dict:
    with db.transaction() as conn:
        item = _load_item(conn, submission_id)
    if item is None or not _can_view(user, item):
        raise HTTPException(404, "Submission not found in your queue")
    # The annotator stays anonymous to the reviewer to keep verdicts unbiased.
    return {
        "submissionId": str(item["id"]),
        "submittedAt": item["created_at"].isoformat(),
        "templateId": item["template_id"],
        "templateTitle": item["template_title"],
        "difficultyTier": item["difficulty_tier"],
        "seed": item["seed"],
        "defaultPoints": item["default_points"],
        "maxPoints": MAX_TASK_POINTS,
        "outcome": item["outcome"],
        "actions": item["actions"],
        "reasonCode": item["reason_code"],
        "confidence": item["confidence"],
        "notes": item["notes"],
        "attempts": item["attempts"],
        "simVersion": item["sim_version"],
        "replay": None
        if not item["replayed"]
        else {
            "valid": item["valid"],
            "goalReached": item["goal_reached"],
            "collision": item["collision"],
            "finalPositionErrorM": item["final_position_error_m"],
            "finalHeadingErrorDeg": item["final_heading_error_deg"],
            "minClearanceStaticM": item["min_clearance_static_m"],
            "minClearanceAgentsM": item["min_clearance_agents_m"],
            "directionChanges": item["direction_changes"],
            "durationS": item["duration_s"],
            "steeringSmoothness": item["steering_smoothness"],
            "clientMismatch": item["client_mismatch"],
            "flags": item["flags"] or [],
            "simVersion": item["replay_sim_version"],
        },
        "review": None
        if item["verdict"] is None
        else {
            "verdict": item["verdict"],
            "comment": item["comment"],
            "pointsSet": item["points_set"],
            "pointsReason": item["points_reason"],
            "reviewedAt": item["reviewed_at"].isoformat(),
        },
    }


@router.post("/items/{submission_id}", status_code=201)
def review_item(
    submission_id: str, body: ReviewIn, user: User = Depends(require("reviewer")), db: Database = Depends(get_db)
) -> dict:
    with db.transaction() as conn:
        item = _load_item(conn, submission_id)
        if item is None or item["reviewer_id"] is None or str(item["reviewer_id"]) != user.id:
            raise HTTPException(404, "Submission not found in your queue")
        if item["verdict"] is not None:
            raise HTTPException(409, "This submission was already reviewed")
        if not item["replayed"]:
            raise HTTPException(409, "The server replay hasn't finished yet; try again in a moment")
        accepted = body.verdict == "accepted"
        if not accepted and not body.comment.strip():
            raise HTTPException(422, "Add a comment explaining the rejection, so the annotator can learn from it")
        try:
            entries = review_entries(
                annotator_id=str(item["annotator_id"]),
                reviewer_id=user.id,
                accepted=accepted,
                points_set=body.pointsSet,
                reason=body.pointsReason,
            )
        except PointsRuleError as e:
            raise HTTPException(422, str(e)) from e
        task_points = next((e.points for uid, e in entries if uid != user.id), None)
        review_id = conn.execute(
            """
            INSERT INTO reviews (submission_id, reviewer_id, batch_id, verdict, scores, comment, points_set, points_reason)
            SELECT %s, %s, bi.batch_id, %s, %s, %s, %s, %s FROM review_batch_items bi WHERE bi.submission_id = %s
            RETURNING id
            """,
            (
                submission_id,
                user.id,
                body.verdict,
                Jsonb(body.scores),
                body.comment.strip(),
                task_points if accepted else 1,
                (body.pointsReason or "").strip() or None if accepted and task_points != 1 else None,
                submission_id,
            ),
        ).fetchone()["id"]
        title = item["template_title"]
        for uid, entry in entries:
            note = f"Reviewed: {title}" if uid == user.id else f"Task accepted: {title}"
            conn.execute(
                """
                INSERT INTO points_ledger (user_id, entry_type, points, submission_id, review_id, note)
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (uid, entry.entry_type, entry.points, submission_id, review_id, note),
            )
    return {"reviewId": str(review_id), "verdict": body.verdict, "pointsAwarded": task_points if accepted else 0}
