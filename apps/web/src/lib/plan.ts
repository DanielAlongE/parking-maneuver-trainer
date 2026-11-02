import { templates } from "@mt/scenarios";
import { simulate, type Pose, type ScenarioInstance, type Segment, type SimResult } from "@mt/sim-core";

export const UNREACHABLE_REASONS = [
  { value: "no_gap", label: "No gap large enough" },
  { value: "blocked_by_agent", label: "Blocked by another road user" },
  { value: "rule_violation_required", label: "Would require breaking a traffic rule" },
  { value: "other", label: "Other" },
] as const;

export function reasonLabel(code: string | null): string {
  return UNREACHABLE_REASONS.find((r) => r.value === code)?.label ?? code ?? "";
}

export function templateTitle(id: string): string {
  return templates[id]?.title ?? id;
}

export const newDrive = (): Segment => ({ kind: "drive", gear: "D", steerDeg: 0, distanceM: 2, speedMps: 1 });
export const newWait = (): Segment => ({ kind: "wait", durationS: 2 });

export interface SegmentEnd {
  /** Index of the last trajectory row of this move. */
  step: number;
  pose: Pose;
  /** False when the run stopped (collision or time limit) before this move ended. */
  completed: boolean;
}

/**
 * Where the car is after each move, for the numbered previews on the scene.
 * Re-runs the plan one move longer each time; plans are short, so this is cheap.
 */
export function segmentEnds(instance: ScenarioInstance, segments: Segment[], full: SimResult): SegmentEnd[] {
  const ends: SegmentEnd[] = [];
  let stopped = false;
  for (let i = 0; i < segments.length; i++) {
    const r = i === segments.length - 1 ? full : simulate(instance, { segments: segments.slice(0, i + 1) });
    const done = !stopped && r.collision === null && !r.timeLimitExceeded;
    ends.push({ step: r.steps, pose: r.finalPose, completed: done });
    if (!done) stopped = true;
  }
  return ends;
}

export function fmtMetres(v: number | null): string {
  return v === null ? "none" : `${v.toFixed(2)} m`;
}

export function timeLeft(expiresAt: string, now = Date.now()): string {
  const ms = Date.parse(expiresAt) - now;
  if (ms <= 0) return "expired";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h} h ${m} min left` : `${m} min left`;
}

export function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export const STATUS_LABELS: Record<string, string> = {
  pending_replay: "Scoring",
  pending_review: "Awaiting review",
  accepted: "Accepted",
  rejected: "Rejected",
  requested: "Requested",
  contacted: "Contacted",
  paid: "Paid",
  cancelled: "Cancelled",
};
