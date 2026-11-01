"""Planner service interface (phase 2). See ../../README.md."""

from typing import Any, TypedDict


class Candidate(TypedDict):
    label: str  # e.g. "shortest", "fewest-direction-changes", "widest-clearance"
    plan: dict[str, Any]  # {"segments": [...]}, same format as annotator plans
    metrics: dict[str, Any]  # result of mt_sim.simulate on the plan


def plan_candidates(instance: dict[str, Any], max_candidates: int = 4) -> list[Candidate]:
    """Diverse collision-free maneuvers for a scenario instance, best first."""
    raise NotImplementedError("Hybrid A* planner is scheduled for phase 2")


def solvable(instance: dict[str, Any], time_budget_s: float = 10.0) -> bool | None:
    """True if a safe solution exists, False if none was found, None if undecided."""
    raise NotImplementedError("Hybrid A* planner is scheduled for phase 2")
