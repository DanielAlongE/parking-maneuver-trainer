import { describe, expect, it } from "vitest";
import { templates, vehicles } from "@mt/scenarios";
import { instantiate, sampleParams, simulate } from "../src/index.js";

const park = templates["parallel-park-kerbside"]!;

describe("instantiate", () => {
  it("is fully determined by template and seed", () => {
    expect(instantiate(park, 42, vehicles)).toEqual(instantiate(park, 42, vehicles));
    expect(sampleParams(park, 42)).not.toEqual(sampleParams(park, 43));
  });

  it("keeps sampled values inside their ranges", () => {
    for (let seed = 0; seed < 200; seed++) {
      const gap = sampleParams(park, seed).gapLength as number;
      expect(gap).toBeGreaterThanOrEqual(6.5);
      expect(gap).toBeLessThanOrEqual(7.6);
    }
  });
});

describe("simulate", () => {
  const instance = instantiate(park, 7, vehicles);

  it("drives straight forward the requested distance", () => {
    const r = simulate(instance, {
      segments: [{ kind: "drive", gear: "D", steerDeg: 0, distanceM: 5, speedMps: 2 }],
    });
    expect(r.finalPose.x - instance.ego.x).toBeCloseTo(5, 9);
    expect(r.finalPose.y).toBeCloseTo(instance.ego.y, 12);
    expect(r.durationS).toBeCloseTo(2.5, 9);
    expect(r.collision).toBeNull();
  });

  it("stops at the first collision and names what was hit", () => {
    const r = simulate(instance, {
      segments: [{ kind: "drive", gear: "D", steerDeg: -35, distanceM: 20, speedMps: 2 }],
    });
    expect(r.collision).not.toBeNull();
    expect(r.goalReached).toBe(false);
  });

  it("counts direction changes between drive segments", () => {
    const r = simulate(instance, {
      segments: [
        { kind: "drive", gear: "D", steerDeg: 0, distanceM: 1, speedMps: 1 },
        { kind: "drive", gear: "R", steerDeg: 0, distanceM: 1, speedMps: 1 },
        { kind: "drive", gear: "D", steerDeg: 0, distanceM: 1, speedMps: 1 },
      ],
    });
    expect(r.directionChanges).toBe(2);
  });

  it("limits the steering rate", () => {
    const r = simulate(instance, {
      segments: [{ kind: "drive", gear: "D", steerDeg: 35, distanceM: 0.1, speedMps: 1 }],
    });
    // 0.1 s at 40 deg/s -> at most 4 degrees of wheel angle.
    expect(r.trajectory.at(-1)![4]).toBeCloseTo((4 * Math.PI) / 180, 9);
  });

  it("is deterministic", () => {
    const plan = {
      segments: [
        { kind: "drive" as const, gear: "R" as const, steerDeg: 30, distanceM: 3, speedMps: 1 },
        { kind: "wait" as const, durationS: 1.3 },
      ],
    };
    expect(simulate(instance, plan)).toEqual(simulate(instance, plan));
  });
});

describe("narrow street agent", () => {
  const street = templates["narrow-street-oncoming"]!;

  it("an assertive oncoming car hits an ego that waits in its lane", () => {
    const seed = [...Array(50).keys()].find((s) => sampleParams(street, s).oncomingBehaviour === "assertive")!;
    const r = simulate(instantiate(street, seed, vehicles), { segments: [{ kind: "wait", durationS: 30 }] });
    expect(r.collision?.withId).toBe("oncoming-car");
  });

  it("a yielding oncoming car stops in front of the ego", () => {
    const seed = [...Array(50).keys()].find((s) => sampleParams(street, s).oncomingBehaviour === "yielding")!;
    const r = simulate(instantiate(street, seed, vehicles), { segments: [{ kind: "wait", durationS: 30 }] });
    expect(r.collision).toBeNull();
    expect(r.minClearanceAgentsM!).toBeGreaterThan(5);
  });
});
