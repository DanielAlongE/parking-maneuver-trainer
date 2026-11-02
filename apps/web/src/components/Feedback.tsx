import type { ScenarioInstance, SimResult } from "@mt/sim-core";
import { fmtMetres } from "../lib/plan";

export function verdictOf(result: SimResult): { cls: "good" | "bad" | "neutral"; text: string } {
  if (result.collision) return { cls: "bad", text: `Collision with ${result.collision.withId} at ${result.collision.t.toFixed(1)} s` };
  if (result.goalReached) return { cls: "good", text: "Goal reached without collision" };
  if (result.timeLimitExceeded) return { cls: "bad", text: "Time limit exceeded" };
  return { cls: "neutral", text: "Goal not reached yet" };
}

/** Instant feedback (ADR D12): the plan is re-simulated in the browser on every edit. */
export function Feedback({ instance, result }: { instance: ScenarioInstance; result: SimResult }) {
  const v = verdictOf(result);
  return (
    <div>
      <div className={`verdict ${v.cls}`} role="status">
        {v.text}
      </div>
      <dl className="metrics">
        <dt>Position error</dt>
        <dd>
          {result.finalPositionErrorM.toFixed(2)} m (limit {instance.goal.positionTol} m)
        </dd>
        <dt>Heading error</dt>
        <dd>
          {result.finalHeadingErrorDeg.toFixed(1)}° (limit {((instance.goal.headingTol * 180) / Math.PI).toFixed(0)}°)
        </dd>
        <dt>Closest to obstacles</dt>
        <dd>{fmtMetres(result.minClearanceStaticM)}</dd>
        <dt>Closest to road users</dt>
        <dd>{fmtMetres(result.minClearanceAgentsM)}</dd>
        <dt>Direction changes</dt>
        <dd>{result.directionChanges}</dd>
        <dt>Duration</dt>
        <dd>{result.durationS.toFixed(1)} s</dd>
      </dl>
    </div>
  );
}
