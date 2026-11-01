"""Points and payout rules from ADR-001 decision D14.

Pure functions, so the rules are tested once and reused by every route.
Balances are always computed from the append-only ledger, never stored.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta
from decimal import Decimal
from typing import Iterable, Literal

POINT_VALUE_USD = Decimal("0.25")
DEFAULT_TASK_POINTS = 1
MAX_TASK_POINTS = 20
REVIEW_POINTS = 1
MIN_PAYOUT_POINTS = 20
CLAIM_WINDOW = timedelta(hours=24)

EntryType = Literal["award", "adjustment", "reversal", "hold", "release"]


class PointsRuleError(ValueError):
    pass


@dataclass(frozen=True)
class LedgerEntry:
    entry_type: EntryType
    points: int


def balance(entries: Iterable[LedgerEntry]) -> int:
    """Redeemable balance. Can go below zero after a late reversal (ADR D14)."""
    return sum(e.points for e in entries)


def task_points(points_set: int | None, reason: str | None = None) -> int:
    """Points a reviewer awards for an accepted task: 1 by default, at most 20."""
    if points_set is None:
        return DEFAULT_TASK_POINTS
    if not isinstance(points_set, int) or not DEFAULT_TASK_POINTS <= points_set <= MAX_TASK_POINTS:
        raise PointsRuleError(f"Task points must be between {DEFAULT_TASK_POINTS} and {MAX_TASK_POINTS}")
    if points_set != DEFAULT_TASK_POINTS and not (reason and reason.strip()):
        raise PointsRuleError("Raising a task's points needs a reason")
    return points_set


def review_entries(
    *, annotator_id: str, reviewer_id: str, accepted: bool, points_set: int | None, reason: str | None
) -> list[tuple[str, LedgerEntry]]:
    """Ledger entries a review creates, as (user_id, entry) pairs.

    The reviewer earns 1 point whatever the verdict or difficulty, so pay never
    pushes the verdict. The annotator earns the task's points only on acceptance.
    """
    if annotator_id == reviewer_id:
        raise PointsRuleError("Nobody reviews their own submission")
    entries = [(reviewer_id, LedgerEntry("award", REVIEW_POINTS))]
    if accepted:
        entries.append((annotator_id, LedgerEntry("award", task_points(points_set, reason))))
    elif points_set is not None and points_set != DEFAULT_TASK_POINTS:
        raise PointsRuleError("Points are only set on accepted submissions")
    return entries


def cash_amount_usd(points: int) -> Decimal:
    return (Decimal(points) * POINT_VALUE_USD).quantize(Decimal("0.01"))


def payout_hold(current_balance: int, points: int) -> LedgerEntry:
    """Validates a payout request and returns the ledger hold it creates."""
    if points < MIN_PAYOUT_POINTS:
        raise PointsRuleError(f"The minimum payout is {MIN_PAYOUT_POINTS} points")
    if points > current_balance:
        raise PointsRuleError("Not enough points")
    return LedgerEntry("hold", -points)


def payout_release(points: int) -> LedgerEntry:
    """Returns held points when a payout request is cancelled."""
    return LedgerEntry("release", points)


def claim_expired(claimed_at: datetime, now: datetime) -> bool:
    return now >= claimed_at + CLAIM_WINDOW
