# Maneuver Trainer

In-house, non-commercial platform where people solve low-speed driving scenarios (parking, tight turns, negotiating with oncoming traffic) in a deterministic 2D simulator. Reviewed solutions become training data for a maneuver model. Participants earn points, redeemable for cash, for accepted work.

Architecture: [docs/adr/0001-maneuver-training-platform.md](docs/adr/0001-maneuver-training-platform.md).

## Repository layout

| Path | What it is | State |
| --- | --- | --- |
| `packages/sim-core` | Deterministic simulator in TypeScript: vehicle model, collisions, clearance, scoring | Working, tested |
| `packages/scenarios` | Vehicle profiles and the three MVP scenario templates (US norms) | Working |
| `packages/golden-vectors` | Fixed cases whose results must match bit for bit everywhere | 9 cases + trig vectors |
| `packages/sim-py` | Python twin of the simulator for training and evaluation | Working, matches golden vectors |
| `apps/web` | Annotator app: top-down view, plan editor, instant feedback, submit or report unreachable | Working prototype |
| `apps/replay-worker` | Server-side authoritative replay and flags for review | Working; queue wiring is phase 1 |
| `apps/api` | FastAPI service, full Postgres schema, points and payout rules | Skeleton; rules tested, storage in memory |
| `apps/planner` | Hybrid A* candidate generator | Interface only (phase 2) |
| `training` | Snapshot export, models, closed-loop evaluation | Phase 2 |
| `infra` | Local Postgres and Redis | Ready |

## Getting started

Requirements: Node 22+, pnpm 10, Python 3.11+, [uv](https://docs.astral.sh/uv/), Docker (for Postgres and Redis).

```bash
pnpm install

# Annotator app with instant feedback, at http://localhost:5173
pnpm dev:web

# API at http://localhost:8000 (the web app submits here)
cd apps/api && uv run uvicorn mt_api.main:app --reload --app-dir src

# Postgres (schema applied on first start) and Redis
docker compose -f infra/docker-compose.yml up -d
```

Try the parallel-park scenario with seed 7 and this plan to see a successful park:

| # | Move | Steer (°) | Distance (m) | Speed (m/s) |
| --- | --- | --- | --- | --- |
| 1 | Reverse | 0 | 1 | 1 |
| 2 | Reverse | -35 | 2.75 | 0.3 |
| 3 | Reverse | 35 | 3 | 0.3 |
| 4 | Forward | 0 | 0.5 | 0.5 |

## Tests

```bash
pnpm typecheck && pnpm test                 # TypeScript: sim core, golden vectors, replay worker
(cd packages/sim-py && uv run pytest)         # Python twin parity with the golden vectors
(cd apps/api && uv run pytest)                # Points rules and API
```

To check parity in a browser, run `pnpm dev:web` and open http://localhost:5173/parity.html. It runs every golden vector in that browser and prints PASS or the first mismatch.

CI (`.github/workflows/ci.yml`) runs all of these, checks the golden vectors are up to date, runs the parity page in headless Chrome, and applies the database migration to Postgres 16.

## The determinism rule

The browser, the replay worker and the Python training code must produce identical results for the same scenario, seed and plan. That is what lets the server re-score every submission and lets training reproduce what annotators saw.

- Change `packages/sim-core` first, then mirror the change line for line in `packages/sim-py`.
- Use `dmath` for trigonometry, never `Math.sin` or `math.sin`.
- If a change is meant to alter results: run `pnpm golden:generate`, bump `SIM_VERSION` in both packages, and commit the new vectors.

## Conventions

- Poses are the midpoint of the rear axle. Internal units are metres, seconds and radians; templates use degrees.
- Positive steering turns left. US right-hand traffic.
- Labels, reviews and the points ledger are append-only.

## Next steps (phase 0 gate: replay parity)

- [x] Golden vectors match in Node, Python and Chrome.
- [ ] Add Firefox and Safari to the browser parity check.
- [ ] Zoom and pan in the scene view (the 100 m narrow street is small at full width).
- [ ] Persist submissions in Postgres and queue replay jobs in Redis.
- [ ] Reviewer queue and admin screens: review batches, claim resets, payout requests.
- [ ] Authentication and roles (annotator, reviewer, admin).
