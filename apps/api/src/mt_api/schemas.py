from datetime import datetime
from typing import Annotated, Literal, Union

from pydantic import BaseModel, Field


class DriveSegment(BaseModel):
    kind: Literal["drive"]
    gear: Literal["D", "R"]
    steerDeg: float
    distanceM: float = Field(ge=0)
    speedMps: float = Field(gt=0)


class WaitSegment(BaseModel):
    kind: Literal["wait"]
    durationS: float = Field(ge=0)


Segment = Annotated[Union[DriveSegment, WaitSegment], Field(discriminator="kind")]


class SubmissionIn(BaseModel):
    simVersion: str
    templateId: str
    seed: int = Field(ge=0)
    outcome: Literal["plan", "unreachable"]
    actions: list[Segment] = Field(default_factory=list, max_length=30)
    reasonCode: Literal["no_gap", "blocked_by_agent", "rule_violation_required", "other"] | None = None
    confidence: int = Field(ge=1, le=5)
    notes: str = ""
    clientResult: dict | None = None


class SubmissionOut(BaseModel):
    id: str
    status: Literal["pending_replay", "pending_review", "accepted", "rejected"]
    createdAt: datetime
    submission: SubmissionIn
