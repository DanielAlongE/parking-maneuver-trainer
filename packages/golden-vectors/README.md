# Golden test vectors

Fixed inputs whose simulation results must be **bit-identical** in every implementation of the simulator: the TypeScript core (browser and Node replay worker) and the Python twin used for training. This is the ADR's replay-parity gate (D1, D11).

| Folder | Contents | Written by |
| --- | --- | --- |
| `cases/` | Template, seed and plan for each case | Hand |
| `expected/` | Instance and full result for each case, plus `_dmath.json` trig vectors | `pnpm golden:generate` (TypeScript core is the reference) |

## Rules

- CI runs the TypeScript and Python parity tests on every change. Any mismatch blocks the merge.
- Regenerate `expected/` only when a change to simulation results is intended. Then bump `SIM_VERSION` in `packages/sim-core/src/index.ts` and `packages/sim-py/src/mt_sim/__init__.py`, and fix the Python twin until its tests pass.
- Add a case for every bug found in replay parity, so it stays fixed.

## Cases

| Case | Outcome |
| --- | --- |
| parallel-park-reference | Goal reached |
| parallel-park-other-seed | Same plan, different gap; goal reached |
| parallel-park-collision | Hits the kerb |
| parallel-park-input-limits | Out-of-range inputs clamped; hits the front car |
| three-point-turn-reference | Goal reached |
| three-point-turn-kerb-strike | Hits the left kerb |
| narrow-street-yielding | Oncoming car holds back; goal reached |
| narrow-street-assertive-pull-in | Pulls into the gap, lets the car pass; goal reached |
| narrow-street-assertive-waits-in-lane | Oncoming car hits the waiting ego |
