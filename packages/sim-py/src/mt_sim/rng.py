"""Seeded random numbers (mulberry32). Twin of packages/sim-core/src/rng.ts."""

_M = 0xFFFFFFFF


def _imul(a: int, b: int) -> int:
    """Low 32 bits of a 32-bit multiply, like JavaScript's Math.imul."""
    return (a * b) & _M


class Rng:
    def __init__(self, seed: int) -> None:
        self.state = seed & _M

    def next(self) -> float:
        """Uniform float in [0, 1)."""
        self.state = (self.state + 0x6D2B79F5) & _M
        t = self.state
        t = _imul(t ^ (t >> 15), 1 | t)
        t = ((t + _imul(t ^ (t >> 7), 61 | t)) & _M) ^ t
        return ((t ^ (t >> 14)) & _M) / 4294967296
