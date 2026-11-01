import { describe, expect, it } from "vitest";
import { boxCorners, polygonDistance, polygonsIntersect } from "../src/index.js";

describe("geometry", () => {
  const a = boxCorners(0, 0, 0, 4, 2);

  it("detects overlap and separation", () => {
    expect(polygonsIntersect(a, boxCorners(3, 0, 0, 4, 2))).toBe(true);
    expect(polygonsIntersect(a, boxCorners(5, 0, 0, 4, 2))).toBe(false);
  });

  it("does not count touching edges as a collision", () => {
    expect(polygonsIntersect(a, boxCorners(4, 0, 0, 4, 2))).toBe(false);
  });

  it("measures the gap between boxes", () => {
    expect(polygonDistance(a, boxCorners(5.5, 0, 0, 4, 2))).toBeCloseTo(1.5, 12);
    expect(polygonDistance(a, boxCorners(0, 3, 0, 4, 2))).toBeCloseTo(1.0, 12);
  });

  it("handles rotated boxes", () => {
    const rotated = boxCorners(4.2, 0, Math.PI / 4, 2, 2);
    // The rotated square's left corner sits at x = 4.2 - sqrt(2) ~ 2.786,
    // and the first box ends at x = 2, so the gap is ~0.786.
    expect(polygonDistance(a, rotated)).toBeCloseTo(4.2 - Math.SQRT2 - 2, 9);
  });
});
