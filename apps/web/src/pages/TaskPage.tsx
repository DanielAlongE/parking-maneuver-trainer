import { templates, vehicles } from "@mt/scenarios";
import { instantiate, simulate, SIM_VERSION, type Segment } from "@mt/sim-core";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { Feedback } from "../components/Feedback";
import { ErrorNote } from "../components/Layout";
import { PlanEditor } from "../components/PlanEditor";
import { PlaybackBar, usePlayback } from "../components/Playback";
import { SceneCanvas } from "../components/SceneCanvas";
import { api, useApi, type Assignment } from "../lib/api";
import { newDrive, segmentEnds, timeLeft, UNREACHABLE_REASONS } from "../lib/plan";

const draftKey = (id: string) => `mt:draft:${id}`;

function loadDraft(id: string): Segment[] {
  try {
    const raw = localStorage.getItem(draftKey(id));
    const parsed = raw ? JSON.parse(raw) : null;
    if (Array.isArray(parsed) && parsed.length > 0) return parsed as Segment[];
  } catch {
    /* storage unavailable */
  }
  return [newDrive()];
}

export function TaskPage() {
  const current = useApi<{ assignment: Assignment | null }>("/assignments/current");
  if (current.loading) return <p className="muted">Loading your task…</p>;
  const a = current.data?.assignment;
  if (!a)
    return (
      <section className="panel">
        <h2>No open task</h2>
        <p className="muted">Your claim may have expired or been submitted.</p>
        <Link to="/tasks">Back to tasks</Link>
        <ErrorNote error={current.error} />
      </section>
    );
  if (!templates[a.templateId]) return <ErrorNote error={`Unknown scenario ${a.templateId}`} />;
  return <TaskWorkspace assignment={a} />;
}

function TaskWorkspace({ assignment: a }: { assignment: Assignment }) {
  const navigate = useNavigate();
  const template = templates[a.templateId]!;
  const instance = useMemo(() => instantiate(template, a.seed, vehicles), [template, a.seed]);
  const [segments, setSegments] = useState<Segment[]>(() => loadDraft(a.id));
  const [selected, setSelected] = useState<number | null>(null);
  const [confidence, setConfidence] = useState(3);
  const [notes, setNotes] = useState("");
  const [reason, setReason] = useState<string>("no_gap");
  const [confirmUnreachable, setConfirmUnreachable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  // Each plan the annotator tried counts as an attempt (ADR D13).
  const attempts = useRef(0);
  const first = useRef(true);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    attempts.current += 1;
    try {
      localStorage.setItem(draftKey(a.id), JSON.stringify(segments));
    } catch {
      /* storage unavailable */
    }
  }, [segments, a.id]);

  const result = useMemo(() => simulate(instance, { segments }), [instance, segments]);
  const ends = useMemo(() => segmentEnds(instance, segments, result), [instance, segments, result]);
  const pb = usePlayback(result);

  const expired = Date.parse(a.expiresAt) <= now;

  const submit = async (outcome: "plan" | "unreachable") => {
    setBusy(true);
    setError(null);
    try {
      await api(`/assignments/${a.id}/submit`, {
        body: {
          simVersion: SIM_VERSION,
          outcome,
          actions: outcome === "plan" ? segments : [],
          reasonCode: outcome === "unreachable" ? reason : null,
          confidence,
          notes,
          attempts: Math.max(1, attempts.current),
          clientResult: { goalReached: result.goalReached, collision: result.collision },
        },
      });
      try {
        localStorage.removeItem(draftKey(a.id));
      } catch {
        /* storage unavailable */
      }
      navigate("/tasks", { state: { flash: "Submitted. It will be scored and then reviewed." } });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <div className="row between wrap">
        <div>
          <h1>{template.title}</h1>
          <p className="muted">{template.description}</p>
        </div>
        <div className={`deadline ${expired ? "bad" : ""}`}>{timeLeft(a.expiresAt, now)}</div>
      </div>

      <SceneCanvas instance={instance} result={result} frame={pb.frame} ends={ends} selected={selected} />
      <PlaybackBar result={result} pb={pb} />

      <div className="columns">
        <section className="panel">
          <h2>Plan</h2>
          <PlanEditor segments={segments} onChange={setSegments} selected={selected} onSelect={setSelected} ends={ends} />
        </section>

        <section className="panel">
          <h2>Feedback</h2>
          <Feedback instance={instance} result={result} />
          <p className="hint">Provisional: the server replays every submission and a reviewer decides.</p>

          <label className="field">
            Confidence
            <input type="range" min={1} max={5} value={confidence} onChange={(e) => setConfidence(Number(e.target.value))} />
            <span className="num">{confidence}/5</span>
          </label>
          <label className="field">
            Notes
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={2000} />
          </label>
          {expired && <p className="error">Your 24 hours on this task have ended, so it can't be submitted.</p>}
          <div className="row gap">
            <button className="primary" disabled={!result.goalReached || busy || expired} onClick={() => submit("plan")}>
              Submit plan
            </button>
            {!result.goalReached && <span className="hint">Reach the goal without a collision to submit.</span>}
          </div>
          <div className="unreachable">
            <select value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason">
              {UNREACHABLE_REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
            {confirmUnreachable ? (
              <>
                <button className="danger" disabled={busy || expired} onClick={() => submit("unreachable")}>
                  Confirm report
                </button>
                <button onClick={() => setConfirmUnreachable(false)}>Cancel</button>
              </>
            ) : (
              <button disabled={expired} onClick={() => setConfirmUnreachable(true)}>
                Goal can't be reached safely
              </button>
            )}
          </div>
          <ErrorNote error={error} />
        </section>
      </div>
    </div>
  );
}
