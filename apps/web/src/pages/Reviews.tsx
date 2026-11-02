import { templates, vehicles } from "@mt/scenarios";
import { instantiate, simulate, type Segment } from "@mt/sim-core";
import { useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Feedback } from "../components/Feedback";
import { ErrorNote } from "../components/Layout";
import { PlanEditor } from "../components/PlanEditor";
import { PlaybackBar, usePlayback } from "../components/Playback";
import { SceneCanvas } from "../components/SceneCanvas";
import { api, useApi } from "../lib/api";
import { fmtDate, fmtMetres, reasonLabel, segmentEnds } from "../lib/plan";

interface QueueItem {
  submissionId: string;
  assignedAt: string;
  submittedAt: string;
  templateId: string;
  templateTitle: string;
  difficultyTier: number;
  outcome: "plan" | "unreachable";
  replayed: boolean;
  valid: boolean | null;
  flags: string[];
}

interface ReviewItem {
  submissionId: string;
  submittedAt: string;
  templateId: string;
  templateTitle: string;
  difficultyTier: number;
  seed: number;
  defaultPoints: number;
  maxPoints: number;
  outcome: "plan" | "unreachable";
  actions: Segment[];
  reasonCode: string | null;
  confidence: number;
  notes: string;
  attempts: number;
  replay: null | {
    valid: boolean;
    goalReached: boolean;
    collision: { withId: string; t: number } | null;
    finalPositionErrorM: number;
    finalHeadingErrorDeg: number;
    minClearanceStaticM: number | null;
    minClearanceAgentsM: number | null;
    directionChanges: number;
    durationS: number;
    clientMismatch: boolean;
    flags: string[];
  };
  review: null | { verdict: string; comment: string; pointsSet: number; pointsReason: string | null };
}

const FLAG_LABELS: Record<string, string> = {
  collision: "Collision",
  goal_not_reached: "Goal not reached",
  client_server_mismatch: "Browser and server disagree",
  "unreachable_report:needs_planner_check": "Unreachable report",
};

function flagLabel(f: string): string {
  return FLAG_LABELS[f] ?? (f.startsWith("sim_version_mismatch") ? "Older simulator version" : f);
}

export function ReviewQueue() {
  const q = useApi<{ pending: QueueItem[]; completedCount: number }>("/reviews/queue");
  if (!q.data) return q.error ? <ErrorNote error={q.error} /> : <p className="muted">Loading…</p>;
  return (
    <section className="panel">
      <div className="row between">
        <h1>Reviews</h1>
        <span className="muted">{q.data.completedCount} reviewed · 1 point each</span>
      </div>
      {q.data.pending.length === 0 ? (
        <p className="muted">Nothing assigned to you right now. An admin assigns reviews individually or in batches.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Scenario</th>
              <th>Tier</th>
              <th>Type</th>
              <th>Server check</th>
              <th>Assigned</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {q.data.pending.map((p) => (
              <tr key={p.submissionId}>
                <td>{p.templateTitle}</td>
                <td>{p.difficultyTier}</td>
                <td>{p.outcome === "plan" ? "Plan" : "Unreachable"}</td>
                <td>
                  {!p.replayed ? (
                    <span className="muted">Scoring…</span>
                  ) : p.flags.length ? (
                    p.flags.map(flagLabel).join(", ")
                  ) : (
                    "Clean"
                  )}
                </td>
                <td>{fmtDate(p.assignedAt)}</td>
                <td className="right">
                  <Link to={`/reviews/${p.submissionId}`}>Review</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

export function ReviewItemPage() {
  const { id = "" } = useParams();
  const item = useApi<ReviewItem>(`/reviews/items/${id}`);
  if (item.error) return <ErrorNote error={item.error} />;
  // Never show one item's data under another item's address, even for a frame.
  if (!item.data || item.data.submissionId !== id) return <p className="muted">Loading…</p>;
  if (!templates[item.data.templateId]) return <ErrorNote error={`Unknown scenario ${item.data.templateId}`} />;
  // Keyed by submission so the verdict form starts fresh for every item.
  return <ReviewWorkspace key={item.data.submissionId} item={item.data} />;
}

function ReviewWorkspace({ item }: { item: ReviewItem }) {
  const navigate = useNavigate();
  const instance = useMemo(() => instantiate(templates[item.templateId]!, item.seed, vehicles), [item]);
  // Re-simulating gives exactly the server's result: the same code runs in both places.
  const result = useMemo(() => simulate(instance, { segments: item.actions }), [instance, item]);
  const ends = useMemo(() => segmentEnds(instance, item.actions, result), [instance, item, result]);
  const pb = usePlayback(result);
  const [selected, setSelected] = useState<number | null>(null);
  const [verdict, setVerdict] = useState<"accepted" | "rejected">("accepted");
  const [pointsSet, setPointsSet] = useState(item.defaultPoints);
  const [pointsReason, setPointsReason] = useState("");
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const r = item.replay;
  const mismatch = r !== null && item.outcome === "plan" && r.goalReached !== result.goalReached;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/reviews/items/${item.submissionId}`, {
        body: {
          verdict,
          comment,
          pointsSet: verdict === "accepted" ? pointsSet : null,
          pointsReason: verdict === "accepted" && pointsSet !== item.defaultPoints ? pointsReason : null,
        },
      });
      const q = await api<{ pending: QueueItem[] }>("/reviews/queue");
      const next = q.pending.find((p) => p.replayed);
      navigate(next ? `/reviews/${next.submissionId}` : "/reviews");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <div className="row between wrap">
        <div>
          <h1>{item.templateTitle}</h1>
          <p className="muted">
            Difficulty tier {item.difficultyTier} · submitted {fmtDate(item.submittedAt)} · {item.attempts} plan edit
            {item.attempts === 1 ? "" : "s"} · confidence {item.confidence}/5
          </p>
        </div>
        <Link to="/reviews">Back to queue</Link>
      </div>

      {item.outcome === "unreachable" && (
        <p className="notice">
          Reported as unreachable: <strong>{reasonLabel(item.reasonCode)}</strong>. The planner check comes in phase 2, so
          judge whether a safe solution exists. Try it in Practice with seed {item.seed} if unsure.
        </p>
      )}
      {item.notes && <p className="quote">Annotator note: {item.notes}</p>}

      <SceneCanvas instance={instance} result={result} frame={pb.frame} ends={ends} selected={selected} />
      <PlaybackBar result={result} pb={pb} />

      <div className="columns">
        <section className="panel">
          <h2>Submitted plan</h2>
          {item.actions.length ? (
            <PlanEditor segments={item.actions} selected={selected} onSelect={setSelected} ends={ends} readOnly />
          ) : (
            <p className="muted">No plan (unreachable report).</p>
          )}
          {item.actions.length > 0 && <Feedback instance={instance} result={result} />}
        </section>

        <section className="panel">
          <h2>Server check</h2>
          {r === null ? (
            <p className="muted">The server replay hasn't finished yet.</p>
          ) : (
            <>
              <div className={`verdict ${r.valid ? "good" : "bad"}`}>
                {r.flags.length ? r.flags.map(flagLabel).join(" · ") : "No problems found"}
              </div>
              {item.outcome === "plan" && (
                <dl className="metrics">
                  <dt>Position error</dt>
                  <dd>{r.finalPositionErrorM.toFixed(2)} m</dd>
                  <dt>Heading error</dt>
                  <dd>{r.finalHeadingErrorDeg.toFixed(1)}°</dd>
                  <dt>Closest to obstacles</dt>
                  <dd>{fmtMetres(r.minClearanceStaticM)}</dd>
                  <dt>Closest to road users</dt>
                  <dd>{fmtMetres(r.minClearanceAgentsM)}</dd>
                  <dt>Direction changes</dt>
                  <dd>{r.directionChanges}</dd>
                  <dt>Duration</dt>
                  <dd>{r.durationS.toFixed(1)} s</dd>
                </dl>
              )}
              {mismatch && <p className="error">This view and the server disagree. Please report it; it is a simulator bug.</p>}
            </>
          )}

          <h2 className="mt">Verdict</h2>
          {item.review ? (
            <p>
              Already reviewed: <strong>{item.review.verdict}</strong>
              {item.review.verdict === "accepted" ? `, ${item.review.pointsSet} points` : ""}.
            </p>
          ) : (
            <form onSubmit={submit} className="stack">
              <div className="row gap">
                <label className="row gap-sm">
                  <input type="radio" checked={verdict === "accepted"} onChange={() => setVerdict("accepted")} /> Accept
                </label>
                <label className="row gap-sm">
                  <input type="radio" checked={verdict === "rejected"} onChange={() => setVerdict("rejected")} /> Reject
                </label>
              </div>
              {verdict === "accepted" && (
                <>
                  <label>
                    Points for this task (default {item.defaultPoints}, up to {item.maxPoints})
                    <input
                      type="number"
                      min={1}
                      max={item.maxPoints}
                      value={pointsSet}
                      onChange={(e) => setPointsSet(Math.round(Number(e.target.value) || 1))}
                    />
                  </label>
                  {pointsSet !== item.defaultPoints && (
                    <label>
                      Why this many points?
                      <input value={pointsReason} onChange={(e) => setPointsReason(e.target.value)} required maxLength={500} />
                    </label>
                  )}
                </>
              )}
              <label>
                Comment for the annotator{verdict === "rejected" ? " (required)" : " (optional)"}
                <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} maxLength={2000} />
              </label>
              <ErrorNote error={error} />
              <button className="primary" disabled={busy || r === null}>
                {verdict === "accepted" ? "Accept" : "Reject"} and open next
              </button>
              <p className="hint">You earn 1 point for each review, whichever verdict you give.</p>
            </form>
          )}
        </section>
      </div>
    </div>
  );
}
