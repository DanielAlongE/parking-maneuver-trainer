/**
 * Oriented-box geometry: corners, separating-axis intersection and
 * polygon-to-polygon distance. Twin: packages/sim-py/src/mt_sim/geometry.py
 */
import { cos, sin, sqrt } from "./dmath.js";

export type Point = [number, number];
export type Polygon = Point[];

/** Corners of a box centred at (cx, cy), given the heading's cos and sin. */
export function boxCornersCS(
  cx: number,
  cy: number,
  c: number,
  s: number,
  length: number,
  width: number,
): Polygon {
  const hl = length / 2.0;
  const hw = width / 2.0;
  const local: Point[] = [
    [hl, hw],
    [-hl, hw],
    [-hl, -hw],
    [hl, -hw],
  ];
  return local.map(([lx, ly]) => [cx + lx * c - ly * s, cy + lx * s + ly * c]);
}

export function boxCorners(
  cx: number,
  cy: number,
  heading: number,
  length: number,
  width: number,
): Polygon {
  return boxCornersCS(cx, cy, cos(heading), sin(heading), length, width);
}

function projectionRange(poly: Polygon, ax: number, ay: number): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const [px, py] of poly) {
    const d = px * ax + py * ay;
    if (d < lo) lo = d;
    if (d > hi) hi = d;
  }
  return [lo, hi];
}

function separatedOnEdgesOf(edgesOf: Polygon, a: Polygon, b: Polygon): boolean {
  const n = edgesOf.length;
  for (let i = 0; i < n; i++) {
    const p1 = edgesOf[i]!;
    const p2 = edgesOf[(i + 1) % n]!;
    const ax = -(p2[1] - p1[1]);
    const ay = p2[0] - p1[0];
    const [minA, maxA] = projectionRange(a, ax, ay);
    const [minB, maxB] = projectionRange(b, ax, ay);
    if (maxA <= minB || maxB <= minA) return true;
  }
  return false;
}

/** True when two convex polygons overlap (touching does not count). */
export function polygonsIntersect(a: Polygon, b: Polygon): boolean {
  if (separatedOnEdgesOf(a, a, b)) return false;
  if (separatedOnEdgesOf(b, a, b)) return false;
  return true;
}

export function pointSegmentDistance(p: Point, a: Point, b: Point): number {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const apx = p[0] - a[0];
  const apy = p[1] - a[1];
  const len2 = abx * abx + aby * aby;
  let t = len2 > 0 ? (apx * abx + apy * aby) / len2 : 0.0;
  if (t < 0) t = 0.0;
  if (t > 1) t = 1.0;
  const dx = apx - t * abx;
  const dy = apy - t * aby;
  return sqrt(dx * dx + dy * dy);
}

/** Minimum distance between two convex polygons; 0 when they overlap. */
export function polygonDistance(a: Polygon, b: Polygon): number {
  if (polygonsIntersect(a, b)) return 0.0;
  let best = Infinity;
  for (const [from, to] of [
    [a, b],
    [b, a],
  ] as const) {
    const n = to.length;
    for (const p of from) {
      for (let i = 0; i < n; i++) {
        const d = pointSegmentDistance(p, to[i]!, to[(i + 1) % n]!);
        if (d < best) best = d;
      }
    }
  }
  return best;
}
