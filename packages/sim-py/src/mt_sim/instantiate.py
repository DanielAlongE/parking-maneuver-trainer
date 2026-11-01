"""Template + seed -> scenario instance. Twin of packages/sim-core/src/instantiate.ts."""

import math
from typing import Any

from .dmath import deg_to_rad, round_mm
from .rng import Rng


def resolve_vehicle(name: str, specs: dict[str, Any]) -> dict[str, Any]:
    v = specs.get(name)
    if v is None:
        raise ValueError(f"Unknown vehicle profile: {name}")
    return {
        "name": name,
        "length": v["length"],
        "width": v["width"],
        "wheelbase": v["wheelbase"],
        "rearOverhang": v["rearOverhang"],
        "maxSteer": deg_to_rad(v["maxSteerDeg"]),
        "maxSteerRate": deg_to_rad(v["maxSteerRateDeg"]),
        "maxSpeedMps": v["maxSpeedMps"],
    }


def sample_params(template: dict[str, Any], seed: int) -> dict[str, Any]:
    rng = Rng(seed)
    out: dict[str, Any] = {}
    for name in sorted(template["params"].keys()):
        spec = template["params"][name]
        u = rng.next()
        if "choices" in spec:
            out[name] = spec["choices"][math.floor(u * len(spec["choices"]))]
        else:
            out[name] = round_mm(spec["min"] + (spec["max"] - spec["min"]) * u)
    return out


def _num(expr: Any, params: dict[str, Any]) -> float:
    if isinstance(expr, (int, float)) and not isinstance(expr, bool):
        return expr
    if "param" in expr:
        v = params[expr["param"]]
        if isinstance(v, str):
            raise ValueError(f"Parameter {expr['param']} is not a number")
        return v
    if "sum" in expr:
        items = expr["sum"]
        if not items:
            raise ValueError("Empty sum")
        acc = _num(items[0], params)
        for item in items[1:]:
            acc = acc + _num(item, params)
        return acc
    return _num(expr["mul"][0], params) * _num(expr["mul"][1], params)


def _str(expr: Any, params: dict[str, Any]) -> str:
    if isinstance(expr, str):
        return expr
    v = params[expr["param"]]
    if not isinstance(v, str):
        raise ValueError(f"Parameter {expr['param']} is not a string")
    return v


def instantiate(template: dict[str, Any], seed: int, vehicles: dict[str, Any]) -> dict[str, Any]:
    p = sample_params(template, seed)

    def n(e: Any) -> float:
        return _num(e, p)

    g = template["goal"]
    return {
        "templateId": template["templateId"],
        "seed": seed,
        "params": p,
        "vehicle": resolve_vehicle(template["vehicleProfile"], vehicles),
        "timeLimitS": template["timeLimitS"],
        "ego": {
            "x": n(template["ego"]["x"]),
            "y": n(template["ego"]["y"]),
            "heading": deg_to_rad(n(template["ego"]["headingDeg"])),
        },
        "goal": {
            "x": n(g["x"]),
            "y": n(g["y"]),
            "heading": deg_to_rad(n(g["headingDeg"])),
            "positionTol": n(g["positionTolM"]),
            "headingTol": deg_to_rad(n(g["headingTolDeg"])),
        },
        "obstacles": [
            {
                "id": o["id"],
                "kind": o["kind"],
                "x": n(o["x"]),
                "y": n(o["y"]),
                "heading": deg_to_rad(n(o["headingDeg"])),
                "length": n(o["length"]),
                "width": n(o["width"]),
            }
            for o in template["obstacles"]
        ],
        "agents": [
            {
                "id": a["id"],
                "kind": a["kind"],
                "behaviour": _str(a["behaviour"], p),
                "x": n(a["x"]),
                "y": n(a["y"]),
                "heading": deg_to_rad(n(a["headingDeg"])),
                "length": n(a["length"]),
                "width": n(a["width"]),
                "speedMps": n(a["speedMps"]),
                "startDelayS": n(a["startDelayS"]),
                "yieldDistanceM": n(a["yieldDistanceM"]),
            }
            for a in template["agents"]
        ],
    }
