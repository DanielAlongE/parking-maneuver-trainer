/**
 * Deterministic math.
 *
 * Math.sin / Math.cos / Math.tan are not guaranteed to give bit-identical
 * results across JavaScript engines, and they differ from Python's libm.
 * Basic IEEE-754 operations (+, -, *, /, sqrt) and floor ARE identical
 * everywhere, so trigonometry is built only from those.
 *
 * Every function here has a line-for-line twin in
 * packages/sim-py/src/mt_sim/dmath.py. Keep the order of operations identical:
 * golden test vectors fail on any difference.
 */

export const PI = 3.141592653589793;
export const TWO_PI = 6.283185307179586;
export const HALF_PI = 1.5707963267948966;

const SIN_TERMS = 12; // odd powers 1..23

const SIN_COEFFS: number[] = (() => {
  const coeffs: number[] = [];
  let fact = 1.0;
  for (let n = 1; n <= 2 * SIN_TERMS - 1; n++) {
    fact = fact * n;
    if (n % 2 === 1) {
      const k = (n - 1) / 2;
      coeffs.push(k % 2 === 0 ? 1.0 / fact : -1.0 / fact);
    }
  }
  return coeffs;
})();

export function sin(x: number): number {
  const k = Math.floor(x / TWO_PI + 0.5);
  let r = x - k * TWO_PI;
  if (r > HALF_PI) {
    r = PI - r;
  } else if (r < -HALF_PI) {
    r = -PI - r;
  }
  const r2 = r * r;
  let acc = SIN_COEFFS[SIN_TERMS - 1]!;
  for (let i = SIN_TERMS - 2; i >= 0; i--) {
    acc = acc * r2 + SIN_COEFFS[i]!;
  }
  return acc * r;
}

export function cos(x: number): number {
  return sin(x + HALF_PI);
}

export function tan(x: number): number {
  return sin(x) / cos(x);
}

export function sqrt(x: number): number {
  return Math.sqrt(x);
}

export function degToRad(deg: number): number {
  return (deg * PI) / 180.0;
}

export function radToDeg(rad: number): number {
  return (rad * 180.0) / PI;
}

/** Wrap an angle to [-PI, PI). */
export function normalizeAngle(a: number): number {
  return a - TWO_PI * Math.floor((a + PI) / TWO_PI);
}

export function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

/** Round to the nearest 1/1000, halves rounded up (same in both languages). */
export function roundMm(v: number): number {
  return Math.floor(v * 1000.0 + 0.5) / 1000.0;
}
