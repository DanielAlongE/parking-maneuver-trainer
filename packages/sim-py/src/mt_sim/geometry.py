"""Oriented-box geometry. Twin of packages/sim-core/src/geometry.ts."""

from .dmath import cos, sin, sqrt

Point = tuple[float, float]
Polygon = list[Point]

INF = float("inf")


def box_corners_cs(cx: float, cy: float, c: float, s: float, length: float, width: float) -> Polygon:
    hl = length / 2.0
    hw = width / 2.0
    local = [(hl, hw), (-hl, hw), (-hl, -hw), (hl, -hw)]
    return [(cx + lx * c - ly * s, cy + lx * s + ly * c) for lx, ly in local]


def box_corners(cx: float, cy: float, heading: float, length: float, width: float) -> Polygon:
    return box_corners_cs(cx, cy, cos(heading), sin(heading), length, width)


def _projection_range(poly: Polygon, ax: float, ay: float) -> tuple[float, float]:
    lo = INF
    hi = -INF
    for px, py in poly:
        d = px * ax + py * ay
        if d < lo:
            lo = d
        if d > hi:
            hi = d
    return lo, hi


def _separated_on_edges_of(edges_of: Polygon, a: Polygon, b: Polygon) -> bool:
    n = len(edges_of)
    for i in range(n):
        p1 = edges_of[i]
        p2 = edges_of[(i + 1) % n]
        ax = -(p2[1] - p1[1])
        ay = p2[0] - p1[0]
        min_a, max_a = _projection_range(a, ax, ay)
        min_b, max_b = _projection_range(b, ax, ay)
        if max_a <= min_b or max_b <= min_a:
            return True
    return False


def polygons_intersect(a: Polygon, b: Polygon) -> bool:
    """True when two convex polygons overlap (touching does not count)."""
    if _separated_on_edges_of(a, a, b):
        return False
    if _separated_on_edges_of(b, a, b):
        return False
    return True


def point_segment_distance(p: Point, a: Point, b: Point) -> float:
    abx = b[0] - a[0]
    aby = b[1] - a[1]
    apx = p[0] - a[0]
    apy = p[1] - a[1]
    len2 = abx * abx + aby * aby
    t = (apx * abx + apy * aby) / len2 if len2 > 0 else 0.0
    if t < 0:
        t = 0.0
    if t > 1:
        t = 1.0
    dx = apx - t * abx
    dy = apy - t * aby
    return sqrt(dx * dx + dy * dy)


def polygon_distance(a: Polygon, b: Polygon) -> float:
    """Minimum distance between two convex polygons; 0 when they overlap."""
    if polygons_intersect(a, b):
        return 0.0
    best = INF
    for frm, to in ((a, b), (b, a)):
        n = len(to)
        for p in frm:
            for i in range(n):
                d = point_segment_distance(p, to[i], to[(i + 1) % n])
                if d < best:
                    best = d
    return best
