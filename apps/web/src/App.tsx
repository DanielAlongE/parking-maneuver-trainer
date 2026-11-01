import { templates, vehicles } from "@mt/scenarios";
import { instantiate, simulate, SIM_VERSION, type Segment } from "@mt/sim-core";
import { useEffect, useMemo, useState } from "react";
import { SceneCanvas } from "./SceneCanvas";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

const UNREACHABLE_REASONS = [
  { value: "no_gap", label: "No gap large enough" },
  { value: "blocked_by_agent", label: "Blocked by another road user" },
  { value: "rule_violation_required", label: "Would require breaking a traffic rule" },
  { value: "other", label: "Other" },
] as const;

const newDrive = (): Segment => ({ kind: "drive", gear: "D", steerDeg: 0, distanceM: 2, speedMps: 1 });
const newWait = (): Segment => ({ kind: "wait", durationS: 2 });
const fmt = (v: number | null, digits = 2) => (v === null ? "n/a" : v.toFixed(digits));
const metres = (v: number | null) => (v === null ? "none" : `${v.toFixed(2)} m`);

export function App() {
  const [templateId, setTemplateId] = useState("parallel-park-kerbside");
  const [seed, setSeed] = useState(7);
  const [segments, setSegments] = useState<Segment[]>([newDrive()]);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [confidence, setConfidence] = useState(3);
  const [unreachableReason, setUnreachableReason] = useState<string>("no_gap");
  const [note, setNote] = useState("");
  const [submitted, setSubmitted] = useState<string | null>(null);

  const template = templates[templateId]!;
  const instance = useMemo(() => instantiate(template, seed, vehicles), [template, seed]);
  // Instant feedback (ADR D12): the whole plan is re-simulated on every edit.
  const result = useMemo(() => simulate(instance, { segments }), [instance, segments]);
  const lastFrame = result.trajectory.length - 1;

  useEffect(() => setFrame(lastFrame), [lastFrame, result]);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let prev = performance.now();
    let f = frame >= lastFrame ? 0 : frame;
    const tick = (now: number) => {
      // Real time: one frame per 50 ms of simulated time (approximately).
      f = Math.min(lastFrame, f + Math.max(1, Math.round((now - prev) / 50)));
      prev = now;
      setFrame(f);
      if (f < lastFrame) raf = requestAnimationFrame(tick);
      else setPlaying(false);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]); // eslint-disable-line react-hooks/exhaustive-deps -- frame is read once at start

  const update = (i: number, patch: Partial<Segment>) =>
    setSegments((s) => s.map((seg, j) => (j === i ? ({ ...seg, ...patch } as Segment) : seg)));
  const remove = (i: number) => setSegments((s) => s.filter((_, j) => j !== i));
  const move = (i: number, d: -1 | 1) =>
    setSegments((s) => {
      const j = i + d;
      if (j < 0 || j >= s.length) return s;
      const next = [...s];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });

  const submit = async (outcome: "plan" | "unreachable") => {
    const body = {
      simVersion: SIM_VERSION,
      templateId,
      seed,
      outcome,
      actions: outcome === "plan" ? segments : [],
      reasonCode: outcome === "unreachable" ? unreachableReason : null,
      confidence,
      notes: note,
      clientResult: {
        goalReached: result.goalReached,
        collision: result.collision,
        finalPositionErrorM: result.finalPositionErrorM,
        minClearanceStaticM: result.minClearanceStaticM,
      },
    };
    try {
      const res = await fetch(`${API_URL}/submissions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      const json = await res.json();
      setSubmitted(`Submitted for review (id ${json.id}).`);
    } catch {
      console.log("Submission (API not reachable):", body);
      setSubmitted("API not reachable; submission written to the browser console.");
    }
  };

  const verdict = result.collision
    ? { cls: "bad", text: `Collision with ${result.collision.withId} at ${result.collision.t.toFixed(1)} s` }
    : result.goalReached
      ? { cls: "good", text: "Goal reached without collision" }
      : result.timeLimitExceeded
        ? { cls: "bad", text: "Time limit exceeded" }
        : { cls: "neutral", text: "Goal not reached yet" };

  return (
    <div className="app">
      <header>
        <h1>Maneuver Trainer</h1>
        <div className="picker">
          <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
            {Object.values(templates).map((t) => (
              <option key={t.templateId} value={t.templateId}>
                {t.title}
              </option>
            ))}
          </select>
          <label>
            Seed <input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value) || 0)} />
          </label>
        </div>
      </header>

      <p className="task">{template.description}</p>

      <SceneCanvas instance={instance} result={result} frame={frame} />

      <div className="playback">
        <button onClick={() => setPlaying((p) => !p)}>{playing ? "Pause" : "Play"}</button>
        <input
          type="range"
          min={0}
          max={lastFrame}
          value={Math.min(frame, lastFrame)}
          onChange={(e) => {
            setPlaying(false);
            setFrame(Number(e.target.value));
          }}
        />
        <span>{(result.trajectory[Math.min(frame, lastFrame)]![0] ?? 0).toFixed(1)} s</span>
      </div>

      <div className="columns">
        <section>
          <h2>Plan</h2>
          <table className="segments">
            <thead>
              <tr>
                <th>#</th>
                <th>Move</th>
                <th>Steer (°, + left)</th>
                <th>Distance (m) / time (s)</th>
                <th>Speed (m/s)</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {segments.map((seg, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  {seg.kind === "drive" ? (
                    <>
                      <td>
                        <select value={seg.gear} onChange={(e) => update(i, { gear: e.target.value as "D" | "R" })}>
                          <option value="D">Forward</option>
                          <option value="R">Reverse</option>
                        </select>
                      </td>
                      <td>
                        <input
                          type="range"
                          min={-35}
                          max={35}
                          step={1}
                          value={seg.steerDeg}
                          onChange={(e) => update(i, { steerDeg: Number(e.target.value) })}
                        />
                        <span className="num">{seg.steerDeg}</span>
                      </td>
                      <td>
                        <input
                          type="number"
                          step={0.25}
                          min={0}
                          value={seg.distanceM}
                          onChange={(e) => update(i, { distanceM: Number(e.target.value) })}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          step={0.1}
                          min={0.1}
                          max={4.2}
                          value={seg.speedMps}
                          onChange={(e) => update(i, { speedMps: Number(e.target.value) })}
                        />
                      </td>
                    </>
                  ) : (
                    <>
                      <td>Wait</td>
                      <td />
                      <td>
                        <input
                          type="number"
                          step={0.5}
                          min={0}
                          value={seg.durationS}
                          onChange={(e) => update(i, { durationS: Number(e.target.value) })}
                        />
                      </td>
                      <td />
                    </>
                  )}
                  <td className="row-actions">
                    <button onClick={() => move(i, -1)} aria-label="Move up">↑</button>
                    <button onClick={() => move(i, 1)} aria-label="Move down">↓</button>
                    <button onClick={() => remove(i)} aria-label="Remove">✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="add">
            <button onClick={() => setSegments((s) => [...s, newDrive()])}>Add move</button>
            <button onClick={() => setSegments((s) => [...s, newWait()])}>Add wait</button>
          </div>
        </section>

        <section>
          <h2>Feedback</h2>
          <div className={`verdict ${verdict.cls}`}>{verdict.text}</div>
          <dl className="metrics">
            <dt>Position error</dt>
            <dd>{fmt(result.finalPositionErrorM)} m (limit {instance.goal.positionTol} m)</dd>
            <dt>Heading error</dt>
            <dd>{fmt(result.finalHeadingErrorDeg, 1)}° (limit {fmt((instance.goal.headingTol * 180) / Math.PI, 0)}°)</dd>
            <dt>Closest to obstacles</dt>
            <dd>{metres(result.minClearanceStaticM)}</dd>
            <dt>Closest to road users</dt>
            <dd>{metres(result.minClearanceAgentsM)}</dd>
            <dt>Direction changes</dt>
            <dd>{result.directionChanges}</dd>
            <dt>Duration</dt>
            <dd>{fmt(result.durationS, 1)} s</dd>
          </dl>
          <p className="hint">Provisional. The server replays every submission and a reviewer decides.</p>

          <label className="field">
            Confidence
            <input type="range" min={1} max={5} value={confidence} onChange={(e) => setConfidence(Number(e.target.value))} />
            <span className="num">{confidence}/5</span>
          </label>
          <label className="field">
            Notes
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          </label>
          <div className="submit">
            <button className="primary" disabled={!result.goalReached} onClick={() => submit("plan")}>
              Submit plan
            </button>
          </div>
          <div className="unreachable">
            <select value={unreachableReason} onChange={(e) => setUnreachableReason(e.target.value)}>
              {UNREACHABLE_REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
            <button onClick={() => submit("unreachable")}>Goal can't be reached safely</button>
          </div>
          {submitted && <p className="hint">{submitted}</p>}
        </section>
      </div>
    </div>
  );
}
