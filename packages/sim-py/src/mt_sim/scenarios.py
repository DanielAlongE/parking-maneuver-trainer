"""Loads the shared scenario templates and vehicle profiles from packages/scenarios."""

import json
from pathlib import Path
from typing import Any

SCENARIOS_DIR = Path(__file__).resolve().parents[3] / "scenarios"


def load_vehicles(root: Path = SCENARIOS_DIR) -> dict[str, Any]:
    return json.loads((root / "vehicles.json").read_text())


def load_templates(root: Path = SCENARIOS_DIR) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for f in sorted((root / "templates").glob("*.json")):
        t = json.loads(f.read_text())
        out[t["templateId"]] = t
    return out
