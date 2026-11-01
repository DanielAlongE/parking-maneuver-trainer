from datetime import datetime, timedelta, timezone
from decimal import Decimal

import pytest

from mt_api.points import (
    LedgerEntry,
    PointsRuleError,
    balance,
    cash_amount_usd,
    claim_expired,
    payout_hold,
    payout_release,
    review_entries,
    task_points,
)


def test_task_points_default_and_limits():
    assert task_points(None) == 1
    assert task_points(20, "hard maneuver") == 20
    with pytest.raises(PointsRuleError):
        task_points(21, "too many")
    with pytest.raises(PointsRuleError):
        task_points(0)


def test_raising_points_needs_a_reason():
    with pytest.raises(PointsRuleError):
        task_points(5, None)
    with pytest.raises(PointsRuleError):
        task_points(5, "   ")


def test_reviewer_earns_one_point_whatever_the_verdict():
    accepted = review_entries(annotator_id="a", reviewer_id="r", accepted=True, points_set=8, reason="tight gap")
    assert accepted == [("r", LedgerEntry("award", 1)), ("a", LedgerEntry("award", 8))]
    rejected = review_entries(annotator_id="a", reviewer_id="r", accepted=False, points_set=None, reason=None)
    assert rejected == [("r", LedgerEntry("award", 1))]


def test_no_self_review():
    with pytest.raises(PointsRuleError):
        review_entries(annotator_id="a", reviewer_id="a", accepted=True, points_set=None, reason=None)


def test_payout_threshold_and_cash_value():
    entries = [LedgerEntry("award", 1)] * 19
    assert balance(entries) == 19
    with pytest.raises(PointsRuleError):
        payout_hold(balance(entries), 19)
    entries.append(LedgerEntry("award", 1))
    hold = payout_hold(balance(entries), 20)
    assert balance([*entries, hold]) == 0
    assert cash_amount_usd(20) == Decimal("5.00")
    assert balance([*entries, hold, payout_release(20)]) == 20


def test_cannot_request_more_than_the_balance():
    with pytest.raises(PointsRuleError):
        payout_hold(25, 30)


def test_late_reversal_can_make_the_balance_negative():
    entries = [LedgerEntry("award", 20), LedgerEntry("hold", -20), LedgerEntry("reversal", -3)]
    assert balance(entries) == -3


def test_claim_window_is_24_hours():
    claimed = datetime(2026, 11, 1, 12, 0, tzinfo=timezone.utc)
    assert not claim_expired(claimed, claimed + timedelta(hours=23, minutes=59))
    assert claim_expired(claimed, claimed + timedelta(hours=24))
