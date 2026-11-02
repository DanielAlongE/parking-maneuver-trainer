"""Replay parity: the Python twin must reproduce the TypeScript golden vectors exactly."""

import json
import math
from pathlib import Path

import pytest

from mt_sim import SIM_VERSION, dmath, instantiate, load_templates, load_vehicles, simulate

GOLDEN = Path(__file__).resolve().parents[2] / "golden-vectors"
CASES = sorted((GOLDEN / "cases").glob("*.json"))
TEMPLATES = load_templates()
VEHICLES = load_vehicles()


def first_difference(a, b, path="$"):
    """Returns a readable path to the first mismatch, or None."""
    if isinstance(a, dict) and isinstance(b, dict):
        if a.keys() != b.keys():
            return f"{path}: keys {sorted(a)} != {sorted(b)}"
        for k in a:
            d = first_difference(a[k], b[k], f"{path}.{k}")
            if d:
                return d
        return None
    if isinstance(a, list) and isinstance(b, list):
        if len(a) != len(b):
            return f"{path}: length {len(a)} != {len(b)}"
        for i, (x, y) in enumerate(zip(a, b)):
            d = first_difference(x, y, f"{path}[{i}]")
            if d:
                return d
        return None
    if isinstance(a, bool) or isinstance(b, bool) or a is None or b is None or isinstance(a, str):
        return None if a == b else f"{path}: {a!r} != {b!r}"
    if a != b or math.copysign(1, a) != math.copysign(1, b):
        return f"{path}: {a!r} != {b!r} (diff {a - b!r})"
    return None


@pytest.mark.parametrize("case_file", CASES, ids=[c.stem for c in CASES])
def test_case_matches_typescript(case_file: Path) -> None:
    case = json.loads(case_file.read_text())
    expected = json.loads((GOLDEN / "expected" / case_file.name).read_text())
    assert expected["simVersion"] == SIM_VERSION, "SIM_VERSION differs between TypeScript and Python"

    template = TEMPLATES[case["templateId"]]
    if case.get("vehicleProfile"):
        template = {**template, "vehicleProfile": case["vehicleProfile"]}
    instance = instantiate(template, case["seed"], VEHICLES)
    diff = first_difference(instance, expected["instance"], "instance")
    assert diff is None, diff

    result = simulate(instance, case["plan"])
    diff = first_difference(result, expected["result"], "result")
    assert diff is None, diff


def test_dmath_matches_typescript() -> None:
    expected = json.loads((GOLDEN / "expected" / "_dmath.json").read_text())
    for row in expected["rows"]:
        x = row["x"]
        assert dmath.sin(x) == row["sin"], f"sin({x})"
        assert dmath.cos(x) == row["cos"], f"cos({x})"
        assert dmath.tan(x) == row["tan"], f"tan({x})"
        assert dmath.normalize_angle(x) == row["normalizeAngle"], f"normalize_angle({x})"


def test_covers_every_vehicle_profile() -> None:
    used = set()
    for f in CASES:
        case = json.loads(f.read_text())
        used.add(case.get("vehicleProfile") or TEMPLATES[case["templateId"]]["vehicleProfile"])
    assert used == set(VEHICLES)
