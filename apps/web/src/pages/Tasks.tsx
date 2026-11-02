import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { ErrorNote, Pill } from "../components/Layout";
import { api, useApi, type Assignment, type MySubmission, type PointsSummary } from "../lib/api";
import { fmtDate, STATUS_LABELS, templateTitle, timeLeft } from "../lib/plan";

/** Annotator home: the current task, points, and past submissions. */
export function Tasks() {
  const navigate = useNavigate();
  const location = useLocation();
  const flash = (location.state as { flash?: string } | null)?.flash;
  const current = useApi<{ assignment: Assignment | null }>("/assignments/current");
  const subs = useApi<{ submissions: MySubmission[] }>("/me/submissions");
  const points = useApi<PointsSummary>("/me/points");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const claim = async () => {
    setBusy(true);
    setError(null);
    try {
      await api("/tasks/claim", { method: "POST" });
      navigate("/task");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const a = current.data?.assignment;
  return (
    <div className="stack-lg">
      {flash && (
        <p className="notice" role="status">
          {flash}
        </p>
      )}
      <div className="cards">
        <section className="panel">
          <h2>Your task</h2>
          {current.loading ? (
            <p className="muted">Loading…</p>
          ) : a ? (
            <>
              <p>
                <strong>{templateTitle(a.templateId)}</strong>
                <br />
                <span className="muted">
                  Claimed {fmtDate(a.claimedAt)} · {timeLeft(a.expiresAt)}
                </span>
              </p>
              <Link className="button primary" to="/task">
                Continue task
              </Link>
            </>
          ) : (
            <>
              <p className="muted">You have no task open. Claiming one gives you 24 hours to finish it.</p>
              <button className="primary" onClick={claim} disabled={busy}>
                {busy ? "Finding a task…" : "Get a task"}
              </button>
            </>
          )}
          <ErrorNote error={error ?? current.error} />
        </section>
        <section className="panel">
          <h2>Points</h2>
          {points.data ? (
            <>
              <p className="big">
                {points.data.balance} <span className="muted">points</span>
              </p>
              <p className="muted">
                Worth ${points.data.balanceUsd}. You can request a payout from {points.data.minPayoutPoints} points.
              </p>
              <Link to="/points">See points and payouts</Link>
            </>
          ) : (
            <ErrorNote error={points.error} />
          )}
        </section>
      </div>

      <section className="panel">
        <h2>Your submissions</h2>
        {subs.data && subs.data.submissions.length === 0 && <p className="muted">Nothing submitted yet.</p>}
        {subs.data && subs.data.submissions.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th>Scenario</th>
                <th>Submitted</th>
                <th>Type</th>
                <th>Status</th>
                <th className="right">Points</th>
                <th>Reviewer note</th>
              </tr>
            </thead>
            <tbody>
              {subs.data.submissions.map((s) => (
                <tr key={s.id}>
                  <td>{templateTitle(s.templateId)}</td>
                  <td>{fmtDate(s.submittedAt)}</td>
                  <td>{s.outcome === "plan" ? "Plan" : "Unreachable"}</td>
                  <td>
                    <Pill status={s.status} label={STATUS_LABELS[s.status]} />
                  </td>
                  <td className="right">{s.pointsAwarded ?? ""}</td>
                  <td>{s.reviewerComment ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <ErrorNote error={subs.error} />
      </section>
    </div>
  );
}
