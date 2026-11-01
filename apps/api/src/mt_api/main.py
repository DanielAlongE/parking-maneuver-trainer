"""FastAPI service: tasks, submissions, reviews and points (ADR D7).

Phase 0 skeleton: submissions are kept in memory. Phase 1 replaces the store
with Postgres (migrations/0001_init.sql) and queues replay jobs in Redis.
"""

import os
import uuid
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from mt_sim import SIM_VERSION, load_templates

from .schemas import SubmissionIn, SubmissionOut

app = FastAPI(title="Maneuver Trainer API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.environ.get("API_CORS_ORIGINS", "http://localhost:5173").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

TEMPLATES = load_templates()
_SUBMISSIONS: dict[str, SubmissionOut] = {}


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "simVersion": SIM_VERSION}


@app.get("/scenarios/templates")
def list_templates() -> list[dict]:
    return [
        {
            "templateId": t["templateId"],
            "title": t["title"],
            "family": t["family"],
            "difficultyTier": t["difficultyTier"],
        }
        for t in TEMPLATES.values()
    ]


@app.post("/submissions", status_code=201)
def create_submission(body: SubmissionIn) -> SubmissionOut:
    if body.templateId not in TEMPLATES:
        raise HTTPException(422, f"Unknown template {body.templateId}")
    if body.outcome == "unreachable" and body.reasonCode is None:
        raise HTTPException(422, "An unreachable report needs a reason")
    if body.outcome == "plan" and not body.actions:
        raise HTTPException(422, "A plan needs at least one segment")
    # TODO(phase 1): authenticate, check the assignment's 24-hour claim window,
    # persist, and queue a replay job for apps/replay-worker.
    out = SubmissionOut(
        id=str(uuid.uuid4()),
        status="pending_replay",
        createdAt=datetime.now(timezone.utc),
        submission=body,
    )
    _SUBMISSIONS[out.id] = out
    return out


@app.get("/submissions/{submission_id}")
def get_submission(submission_id: str) -> SubmissionOut:
    if submission_id not in _SUBMISSIONS:
        raise HTTPException(404, "Not found")
    return _SUBMISSIONS[submission_id]
