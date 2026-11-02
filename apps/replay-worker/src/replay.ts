/**
 * Authoritative server-side replay (ADR D9). Runs the same @mt/sim-core
 * package as the browser, so a client/server mismatch is a determinism bug,
 * never the annotator's fault.
 */
import { templates, vehicles } from "@mt/scenarios";
import { instantiate, simulate, SIM_VERSION, type Plan } from "@mt/sim-core";

export interface ReplayJob {
  submissionId: string;
  simVersion: string;
  templateId: string;
  seed: number;
  outcome: "plan" | "unreachable";
  actions: Plan["segments"];
  clientResult?: { goalReached: boolean } | null;
}

export interface ReplayResult {
  submissionId: string;
  simVersion: string;
  valid: boolean;
  goalReached: boolean;
  collision: { step: number; t: number; withId: string } | null;
  finalPositionErrorM: number;
  finalHeadingErrorDeg: number;
  minClearanceStaticM: number | null;
  minClearanceAgentsM: number | null;
  directionChanges: number;
  durationS: number;
  steeringSmoothnessDegPerS: number;
  /** True when the browser's provisional result disagreed with this replay. */
  clientMismatch: boolean;
  /** Full trajectory. Not stored: reviewers re-simulate the plan in the browser, which gives identical results. */
  trajectory: number[][];
  flags: string[];
}

export function replay(job: ReplayJob): ReplayResult {
  const flags: string[] = [];
  if (job.simVersion !== SIM_VERSION) flags.push(`sim_version_mismatch:${job.simVersion}->${SIM_VERSION}`);
  const template = templates[job.templateId];
  if (!template) throw new Error(`Unknown template ${job.templateId}`);

  const instance = instantiate(template, job.seed, vehicles);
  const r = simulate(instance, { segments: job.outcome === "plan" ? job.actions : [] });

  // An unreachable report replays an empty plan, so the client's result for
  // whatever plan was on screen is not comparable.
  const clientMismatch =
    job.outcome === "plan" &&
    job.clientResult !== undefined &&
    job.clientResult !== null &&
    job.clientResult.goalReached !== r.goalReached;
  if (clientMismatch) flags.push("client_server_mismatch");
  if (r.collision) flags.push("collision");
  if (job.outcome === "plan" && !r.goalReached) flags.push("goal_not_reached");
  if (job.outcome === "unreachable") flags.push("unreachable_report:needs_planner_check");

  return {
    submissionId: job.submissionId,
    simVersion: SIM_VERSION,
    valid: job.outcome === "unreachable" || (r.goalReached && r.collision === null),
    goalReached: r.goalReached,
    collision: r.collision,
    finalPositionErrorM: r.finalPositionErrorM,
    finalHeadingErrorDeg: r.finalHeadingErrorDeg,
    minClearanceStaticM: r.minClearanceStaticM,
    minClearanceAgentsM: r.minClearanceAgentsM,
    directionChanges: r.directionChanges,
    durationS: r.durationS,
    steeringSmoothnessDegPerS: r.steeringSmoothnessDegPerS,
    clientMismatch,
    trajectory: r.trajectory,
    flags,
  };
}
