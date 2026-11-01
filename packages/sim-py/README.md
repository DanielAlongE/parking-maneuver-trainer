# mt-sim (Python twin)

Python port of `@mt/sim-core`, used by training and closed-loop evaluation (ADR decision D11). Every module mirrors a TypeScript file line for line, and the parity tests require bit-identical results against the golden vectors.

```bash
uv sync
uv run pytest
```

```python
from mt_sim import instantiate, load_templates, load_vehicles, simulate

instance = instantiate(load_templates()["parallel-park-kerbside"], 7, load_vehicles())
result = simulate(instance, {"segments": [
    {"kind": "drive", "gear": "R", "steerDeg": -35, "distanceM": 2.75, "speedMps": 0.3},
]})
print(result["goalReached"], result["minClearanceStaticM"])
```

When editing: change the TypeScript file first, then make the same change here in the same order of operations. Never use `math.sin`, `math.cos` or `math.tan`; use `mt_sim.dmath`.
