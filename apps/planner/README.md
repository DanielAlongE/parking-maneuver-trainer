# Planner service (phase 2)

Generates candidate maneuvers for ranking tasks and checks "goal unreachable" reports (ADR D5, D13).

Planned design:

- Hybrid A* search with Reeds-Shepp expansions over the vehicle profile from `packages/scenarios/vehicles.json`.
- Every candidate is converted to a segment plan and scored with the Python twin (`packages/sim-py`), so the planner and annotators are judged by the same simulator and metrics.
- Diverse candidates per instance: shortest path, fewest direction changes, widest clearance.
- Results are stored in `candidate_plans` when an instance is created, so annotators never wait on planning.
- For an unreachable report, the service searches for a collision-free solution within the clearance thresholds and writes `planner_solvable` on the replay result.

`src/mt_planner/__init__.py` holds the interface the API and replay worker will call.
