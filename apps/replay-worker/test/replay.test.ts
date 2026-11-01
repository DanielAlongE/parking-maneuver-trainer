import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SIM_VERSION } from "@mt/sim-core";
import { replay } from "../src/replay.js";

const reference = JSON.parse(
  readFileSync(new URL("../../../packages/golden-vectors/cases/parallel-park-reference.json", import.meta.url), "utf8"),
);

describe("replay", () => {
  const base = {
    submissionId: "s1",
    simVersion: SIM_VERSION,
    templateId: reference.templateId,
    seed: reference.seed,
    outcome: "plan" as const,
    actions: reference.plan.segments,
  };

  it("accepts a plan that reaches the goal", () => {
    const r = replay({ ...base, clientResult: { goalReached: true } });
    expect(r.valid).toBe(true);
    expect(r.flags).toEqual([]);
  });

  it("flags a client result that disagrees with the replay", () => {
    const r = replay({ ...base, clientResult: { goalReached: false } });
    expect(r.clientMismatch).toBe(true);
    expect(r.flags).toContain("client_server_mismatch");
  });

  it("flags unreachable reports for a planner check", () => {
    const r = replay({ ...base, outcome: "unreachable", actions: [] });
    expect(r.valid).toBe(true);
    expect(r.flags).toContain("unreachable_report:needs_planner_check");
  });
});
