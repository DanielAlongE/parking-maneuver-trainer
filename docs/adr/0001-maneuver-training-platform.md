# ADR-001: Architecture for a Human-in-the-Loop Maneuver Training Platform

- **Status:** Accepted, November 1, 2026
- **Deciders:** Admin or designated reviewer
- **Full record:** [ADR-001 document](https://claude.ai/artifact/2E1vrjXQBx59JLW1W8HBaQ). This file is a summary for the repository; the document is the source of truth.

## Decision summary

| # | Area | Decision | Where in this repo |
| --- | --- | --- | --- |
| D1 | Simulator | Custom 2D top-down simulator, TypeScript core, runs in browser and Node | `packages/sim-core` |
| D2 | Vehicle model | Kinematic bicycle model, fixed 50 ms step, deterministic math | `packages/sim-core/src/simulate.ts`, `dmath.ts` |
| D3 | Scenarios | Versioned JSON templates plus seed, US norms; UniqueData parking dataset for in-house use only | `packages/scenarios` |
| D4 | Human input | Segment plans, keyframes, ranking, decision points, "goal unreachable" | `apps/web` (segment plans and unreachable so far) |
| D5 | Candidate plans | Hybrid A* planner in Python | `apps/planner` (phase 2) |
| D6 | Other agents | Seeded rule-based behaviour profiles | `simulate.ts` (assertive, yielding, stationary) |
| D7 | Backend | FastAPI, PostgreSQL, object storage, Redis | `apps/api`, `infra/docker-compose.yml` |
| D8 | Frontend | React, TypeScript, Canvas 2D, desktop only | `apps/web` |
| D9 | Label quality | Server replay pre-screens; reviewer's verdict is final; 24-hour claim window | `apps/replay-worker`, `apps/api` |
| D10 | Training data | Append-only labels, Parquet snapshots | `training` (phase 2) |
| D11 | Python parity | Python twin held to the TypeScript core by golden vectors | `packages/sim-py`, `packages/golden-vectors` |
| D12 | Instant feedback | Client-side sim scores every edit; server replay confirms | `apps/web/src/App.tsx` |
| D13 | Unreachable goals | Submission type with reason; planner cross-check; reviewer decides | `apps/api`, `apps/replay-worker` |
| D14 | Points and payouts | 1 point = 0.25 USD; 1 point per task, up to 20; reviewers 1 per review; 20-point minimum; admin pays by email | `apps/api/src/mt_api/points.py`, `migrations/0001_init.sql` |

## Implementation notes not in the ADR document

- Poses refer to the midpoint of the rear axle. Units are metres, seconds and radians internally; templates use degrees.
- Trigonometry is computed from basic IEEE operations (`dmath`), because `Math.sin` and Python's `math.sin` are not guaranteed to agree bit for bit.
- A yielding oncoming car holds its position while the ego car is in its lane within 60 m ahead; an assertive car never stops.
- The three-point-turn road is 8 to 9 m wide; 7 to 8 m was not solvable for the mid-size sedan profile. The parallel-park gap is 6.5 to 7.6 m, matching typical US spaces.

## Phase 1 implementation decisions

Choices made while building the MVP that the ADR document left open:

| Area | Decision |
| --- | --- |
| Sign-in | Email and password; scrypt hashes; HttpOnly SameSite=Lax session cookie. Accounts exist only through admin invites (one-time links, 7 days). Re-issuing an invite doubles as a password reset and signs the user out everywhere. |
| First admin | `pnpm create-admin` prints an invite link. |
| Claims | One open claim per annotator. Expiry is applied when claims are read; expired tasks stay out of the queue until an admin resets them. |
| Rejected tasks | Return to the queue for other annotators, never the one who failed them. |
| Plan submission | The Submit button needs the browser's replay to reach the goal without a collision; otherwise the annotator reports the goal as unreachable. The number of plan edits is recorded as `attempts`. |
| Replay | The API pushes each submission id to Redis; the worker also sweeps Postgres for submissions without a result, so a lost job only delays scoring. Trajectories are not stored: reviewers re-simulate the plan in the browser, which gives identical results. |
| Review | One verdict per submission. Reviews require the server replay first. Rejections need a comment. Reviewers can't see who the annotator was. |
| Tasks | Admins generate tasks with random seeds or a list of specific seeds. |
| Unreachable reports | Reviewers judge them unaided until the planner check arrives in phase 2. |
