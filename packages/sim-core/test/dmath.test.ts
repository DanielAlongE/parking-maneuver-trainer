import { describe, expect, it } from "vitest";
import { dmath } from "../src/index.js";

describe("deterministic trig", () => {
  it("stays within 1e-14 of the platform functions", () => {
    for (let x = -20; x <= 20; x += 0.0137) {
      expect(Math.abs(dmath.sin(x) - Math.sin(x))).toBeLessThan(1e-14);
      expect(Math.abs(dmath.cos(x) - Math.cos(x))).toBeLessThan(1e-14);
    }
  });

  it("normalizes angles into [-PI, PI)", () => {
    for (const a of [-10, -Math.PI, 0, 3, Math.PI, 7, 100]) {
      const n = dmath.normalizeAngle(a);
      expect(n).toBeGreaterThanOrEqual(-Math.PI);
      expect(n).toBeLessThan(Math.PI);
      expect(Math.abs(dmath.sin(n) - dmath.sin(a))).toBeLessThan(1e-12);
    }
  });
});
