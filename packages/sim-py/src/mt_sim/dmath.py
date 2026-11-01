"""Deterministic math. Twin of packages/sim-core/src/dmath.ts.

Do not use math.sin / math.cos / math.tan here: they differ from JavaScript
engines in the last bits. Keep the order of operations identical to the
TypeScript file.
"""

import math

PI = 3.141592653589793
TWO_PI = 6.283185307179586
HALF_PI = 1.5707963267948966

SIN_TERMS = 12  # odd powers 1..23


def _sin_coeffs() -> list[float]:
    coeffs: list[float] = []
    fact = 1.0
    for n in range(1, 2 * SIN_TERMS):
        fact = fact * n
        if n % 2 == 1:
            k = (n - 1) // 2
            coeffs.append(1.0 / fact if k % 2 == 0 else -1.0 / fact)
    return coeffs


SIN_COEFFS = _sin_coeffs()


def sin(x: float) -> float:
    k = math.floor(x / TWO_PI + 0.5)
    r = x - k * TWO_PI
    if r > HALF_PI:
        r = PI - r
    elif r < -HALF_PI:
        r = -PI - r
    r2 = r * r
    acc = SIN_COEFFS[SIN_TERMS - 1]
    for i in range(SIN_TERMS - 2, -1, -1):
        acc = acc * r2 + SIN_COEFFS[i]
    return acc * r


def cos(x: float) -> float:
    return sin(x + HALF_PI)


def tan(x: float) -> float:
    return sin(x) / cos(x)


def sqrt(x: float) -> float:
    return math.sqrt(x)


def deg_to_rad(deg: float) -> float:
    return (deg * PI) / 180.0


def rad_to_deg(rad: float) -> float:
    return (rad * 180.0) / PI


def normalize_angle(a: float) -> float:
    """Wrap an angle to [-PI, PI)."""
    return a - TWO_PI * math.floor((a + PI) / TWO_PI)


def clamp(v: float, lo: float, hi: float) -> float:
    if v < lo:
        return lo
    if v > hi:
        return hi
    return v


def round_mm(v: float) -> float:
    """Round to the nearest 1/1000, halves rounded up (same as the TS twin)."""
    return math.floor(v * 1000.0 + 0.5) / 1000.0
