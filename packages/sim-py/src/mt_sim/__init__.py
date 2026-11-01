"""Python twin of @mt/sim-core.

Every module mirrors a TypeScript file in packages/sim-core/src line for line.
Golden test vectors (packages/golden-vectors) must match exactly.
"""

from .instantiate import instantiate, resolve_vehicle, sample_params
from .scenarios import load_templates, load_vehicles
from .simulate import DT, simulate

# Must equal SIM_VERSION in packages/sim-core/src/index.ts.
SIM_VERSION = "0.1.0"

__all__ = [
    "DT",
    "SIM_VERSION",
    "instantiate",
    "load_templates",
    "load_vehicles",
    "resolve_vehicle",
    "sample_params",
    "simulate",
]
