# Golden test vectors

Fixed inputs whose simulation results must be **bit-identical** in every implementation of the simulator: the TypeScript core (browser and Node replay worker) and the Python twin used for training. This is the ADR's replay-parity gate (D1, D11).

A case may set `vehicleProfile` to replace the template's vehicle; together the cases cover every profile in `packages/scenarios/vehicles.json`, and a test fails if one is left out.

| Folder | Contents | Written by |
| --- | --- | --- |
| `cases/` | Template, seed and plan for each case | Hand |
| `expected/` | Instance and full result for each case, plus `_dmath.json` trig vectors | `pnpm golden:generate` (TypeScript core is the reference) |

## Rules

- CI runs the TypeScript and Python parity tests on every change. Any mismatch blocks the merge.
- Regenerate `expected/` only when a change to simulation results is intended. Then bump `SIM_VERSION` in `packages/sim-core/src/version.ts` and `packages/sim-py/src/mt_sim/__init__.py`, and fix the Python twin until its tests pass.
- Add a case for every bug found in replay parity, so it stays fixed.

## Cases

| Case | Vehicle | Outcome |
| --- | --- | --- |
| parallel-park-reference | Sedan | Goal reached |
| parallel-park-other-seed | Sedan | Same plan, different gap; goal reached |
| parallel-park-collision | Sedan | Hits the kerb |
| parallel-park-input-limits | Sedan | Out-of-range inputs clamped; hits the front car |
| parallel-park-hatchback | Hatchback | Same plan; no collision, goal missed |
| parallel-park-suv | Large SUV | Same plan; hits the front car |
| three-point-turn-reference | Sedan | Goal reached |
| three-point-turn-kerb-strike | Sedan | Hits the left kerb |
| three-point-turn-hatchback | Hatchback | Same plan; no collision, goal missed |
| narrow-street-yielding | Sedan | Oncoming car holds back; goal reached |
| narrow-street-assertive-pull-in | Sedan | Pulls into the gap, lets the car pass; goal reached |
| narrow-street-assertive-waits-in-lane | Sedan | Oncoming car hits the waiting ego |
| narrow-street-suv-pull-in | Large SUV | Same plan; oncoming car hits the SUV |

## Where the vectors run

| Runtime | Engine | How |
| --- | --- | --- |
| Node | V8 | `pnpm test` |
| Python twin | CPython | `cd packages/sim-py && uv run pytest` |
| Engine shells | V8, JavaScriptCore (Safari), SpiderMonkey (Firefox) | `pnpm parity:engines` |
| Browsers | Chromium, Firefox, WebKit | `pnpm parity:browsers` (Playwright), or open `/parity.html` in any browser |
