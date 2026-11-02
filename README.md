# Maneuver Trainer

In-house, non-commercial platform where people solve low-speed driving scenarios (parking, tight turns, negotiating with oncoming traffic) in a deterministic 2D simulator. Reviewed solutions become training data for a maneuver model. Participants earn points, redeemable for cash, for accepted work.

Architecture: [docs/adr/0001-maneuver-training-platform.md](docs/adr/0001-maneuver-training-platform.md).

## Repository layout

| Path | What it is | State |
| --- | --- | --- |
| `packages/sim-core` | Deterministic simulator in TypeScript: vehicle model, collisions, clearance, scoring | Working, tested |
| `packages/scenarios` | Vehicle profiles and the three MVP scenario templates (US norms) | Working |
| `packages/golden-vectors` | Fixed cases whose results must match bit for bit everywhere | 13 cases (all 3 vehicles) + trig vectors |
| `packages/sim-py` | Python twin of the simulator for training and evaluation | Working, matches golden vectors |
| `apps/web` | Web app: sign-in, annotator tasks, reviewer queue, admin screens, practice mode | Working, tested end to end |
| `apps/replay-worker` | Takes jobs from Redis, replays each submission, writes scores to Postgres | Working, tested |
| `apps/api` | FastAPI service: accounts, tasks and claims, submissions, reviews, points, payouts | Working, tested against Postgres |
| `apps/planner` | Hybrid A* candidate generator | Interface only (phase 2) |
| `training` | Snapshot export, models, closed-loop evaluation | Phase 2 |
| `infra` | Local Postgres and Redis | Ready |

## Getting started

Requirements: Node 22+, pnpm 10, Python 3.11+, [uv](https://docs.astral.sh/uv/), Docker (for Postgres and Redis).

```bash
pnpm install
docker compose -f infra/docker-compose.yml up -d    # Postgres and Redis

# Create the database tables and the first admin. Open the printed link to set a password.
pnpm db:migrate
pnpm create-admin --email you@example.com --name "Your Name"

# Then, each in its own terminal:
pnpm dev:api       # API on http://localhost:8000
pnpm dev:worker    # scores submissions
pnpm dev:web       # web app on http://localhost:5173 (forwards /api to the API)
```

Settings come from environment variables; the defaults match `infra/docker-compose.yml`. See `.env.example`.

### Running a pilot

1. **Admin → Overview:** generate tasks for each scenario (random seeds, or specific seeds).
2. **Admin → Users:** invite annotators and reviewers. Each invite is a one-time link, valid 7 days; send it yourself. The same button issues a password-reset link later.
3. **Annotators** claim a task (24 hours to finish), build a plan with instant feedback, and submit it or report that the goal can't be reached safely.
4. **The worker** replays every submission on the server and flags collisions, missed goals and browser/server mismatches.
5. **Admin → Review batches:** assign scored submissions to a reviewer, oldest first or hand-picked. Reviewers never get their own work and don't see who the annotator was.
6. **Reviewers** accept (1 point by default, up to 20 with a reason) or reject (comment required). Points show up at once; reviewers earn 1 point per review.
7. **Annotators** request a payout from 20 points (1 point = $0.25). **Admin → Payouts:** email them, then mark the request paid with the payment reference, or cancel it to return the points.
8. **Admin → Expired claims:** tasks whose 24 hours ran out wait here until reset.

**Practice** lets anyone try any scenario and seed without submitting. The reference plan below parks successfully in the parallel-park scenario with seed 7:

| # | Move | Steer (°) | Distance (m) | Speed (m/s) |
| --- | --- | --- | --- | --- |
| 1 | Reverse | 0 | 1 | 1 |
| 2 | Reverse | -35 | 2.75 | 0.3 |
| 3 | Reverse | 35 | 3 | 0.3 |
| 4 | Forward | 0 | 0.5 | 0.5 |

### Security notes

- Passwords are hashed with scrypt. Sessions are random tokens in an HttpOnly, SameSite=Lax cookie; only hashes of session and invite tokens are stored.
- Set `COOKIE_SECURE=true` and serve over HTTPS before the app is reachable from the internet.
- No payment details are ever stored; payouts are arranged by email.
- Not yet built: sign-in rate limiting and audit of reviewer point adjustments (see the ADR's fraud controls).

## Tests

```bash
pnpm typecheck && pnpm test                 # TypeScript: sim core, golden vectors, replay worker
(cd packages/sim-py && uv run pytest)         # Python twin parity with the golden vectors
(cd apps/api && uv run pytest)                # Points rules; API tests need TEST_DATABASE_URL
pnpm parity:engines                           # Golden vectors in V8, JavaScriptCore and SpiderMonkey shells
pnpm parity:browsers                          # Golden vectors in Chromium, Firefox and WebKit (Playwright)
bash scripts/e2e.sh                           # Whole workflow in a browser; needs DATABASE_URL and REDIS_URL
```

Database tests drop and rebuild the schema of the database they're given, so point them at throwaway databases:

```bash
TEST_DATABASE_URL=postgresql://mt:mt@localhost:5432/mt_test (cd apps/api && uv run pytest)
TEST_WORKER_DATABASE_URL=postgresql://mt:mt@localhost:5432/mt_worker TEST_REDIS_URL=redis://localhost:6379/1 pnpm test
DATABASE_URL=postgresql://mt:mt@localhost:5432/mt_e2e REDIS_URL=redis://localhost:6379/2 bash scripts/e2e.sh
```

Create those databases once with `docker compose -f infra/docker-compose.yml exec postgres createdb -U mt mt_test` (and likewise `mt_worker`, `mt_e2e`).

`pnpm parity:engines` uses whichever engine shells are installed. On macOS it finds the system JavaScriptCore, the engine inside Safari; on Ubuntu install them with `sudo apt-get install libjavascriptcoregtk-bin gjs`. `pnpm parity:browsers` needs the browsers once: `pnpm --filter @mt/web exec playwright install chromium firefox webkit`.

To check any other browser by hand, run `pnpm dev:web` and open http://localhost:5173/parity.html. It prints PASS or the first mismatch.

CI (`.github/workflows/ci.yml`) runs all of these on Linux and macOS with Postgres 16 and Redis 7, and checks the golden vectors are up to date.

## The determinism rule

The browser, the replay worker and the Python training code must produce identical results for the same scenario, seed and plan. That is what lets the server re-score every submission and lets training reproduce what annotators saw.

- Change `packages/sim-core` first, then mirror the change line for line in `packages/sim-py`.
- Use `dmath` for trigonometry, never `Math.sin` or `math.sin`.
- If a change is meant to alter results: run `pnpm golden:generate`, bump `SIM_VERSION` in both packages, and commit the new vectors.

## Conventions

- Poses are the midpoint of the rear axle. Internal units are metres, seconds and radians; templates use degrees.
- Positive steering turns left. US right-hand traffic.
- Labels, reviews and the points ledger are append-only.

## Phase 0 gate: replay parity

Met when the same scenario, seed and plan give bit-identical results everywhere the simulator runs.

- [x] Simulator core with 3 vehicle profiles, collision and clearance checks
- [x] Golden vectors covering every scenario and vehicle (13 cases)
- [x] Identical results in Node, Python, Chromium, and the JavaScriptCore and SpiderMonkey engines
- [x] CI covering Firefox, WebKit on Linux and macOS, and the macOS system JavaScriptCore
- [ ] Push to GitHub and see every CI job pass once

## Phase 1: MVP

- [x] Accounts by admin invitation, email and password sign-in, roles (annotator, reviewer, admin)
- [x] Submissions in Postgres; replay jobs through Redis, with a database sweep as a fallback
- [x] Task queue with 24-hour claims and admin reset of expired claims
- [x] Reviewer queue, review batches, verdicts and points (1 to 20)
- [x] Points dashboard, payout requests from 20 points, admin payout list
- [x] Zoom and pan in the scene, per-move previews, practice mode
- [ ] Gate: run a pilot; median task under 2 minutes and 50 valid labels per scenario
