import { useState, type FormEvent } from "react";
import { ErrorNote, Pill } from "../components/Layout";
import { api, useApi, type PointsSummary } from "../lib/api";
import { fmtDate, STATUS_LABELS } from "../lib/plan";

const TYPE_LABELS: Record<string, string> = {
  award: "Earned",
  hold: "Redeemed",
  release: "Returned",
  reversal: "Reversed",
  adjustment: "Adjusted",
};

export function Points() {
  const summary = useApi<PointsSummary>("/me/points");
  const [points, setPoints] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!summary.data) return summary.error ? <ErrorNote error={summary.error} /> : <p className="muted">Loading…</p>;
  const s = summary.data;
  const canRequest = s.balance >= s.minPayoutPoints;

  const request = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const n = Number(points || s.balance);
      const r = await api<{ payout: { cashAmountUsd: string } }>("/me/payouts", { body: { points: n } });
      setDone(`Requested ${n} points ($${r.payout.cashAmountUsd}). An admin will email you to arrange payment.`);
      setPoints("");
      summary.reload();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack-lg">
      <div className="cards">
        <section className="panel">
          <h2>Balance</h2>
          <p className="big">
            {s.balance} <span className="muted">points</span>
          </p>
          <p className="muted">1 point = $0.25, so your balance is worth ${s.balanceUsd}.</p>
        </section>
        <section className="panel">
          <h2>Request a payout</h2>
          {canRequest ? (
            <form onSubmit={request} className="stack">
              <label>
                Points to redeem (minimum {s.minPayoutPoints})
                <input
                  type="number"
                  min={s.minPayoutPoints}
                  max={s.balance}
                  placeholder={String(s.balance)}
                  value={points}
                  onChange={(e) => setPoints(e.target.value)}
                />
              </label>
              <button className="primary" disabled={busy}>
                Request payout
              </button>
            </form>
          ) : (
            <p className="muted">
              You can request a payout once you have {s.minPayoutPoints} points ({s.minPayoutPoints - s.balance} to go).
            </p>
          )}
          <p className="hint">Payment details are arranged by email, never entered here.</p>
          <ErrorNote error={error} />
          {done && <p className="notice">{done}</p>}
        </section>
      </div>

      {s.payouts.length > 0 && (
        <section className="panel">
          <h2>Payout requests</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Requested</th>
                <th className="right">Points</th>
                <th className="right">Amount</th>
                <th>Status</th>
                <th>Paid</th>
              </tr>
            </thead>
            <tbody>
              {s.payouts.map((p) => (
                <tr key={p.id}>
                  <td>{fmtDate(p.requestedAt)}</td>
                  <td className="right">{p.points}</td>
                  <td className="right">${p.cashAmountUsd}</td>
                  <td>
                    <Pill status={p.status} label={STATUS_LABELS[p.status]} />
                  </td>
                  <td>{p.paidAt ? fmtDate(p.paidAt) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section className="panel">
        <h2>History</h2>
        {s.entries.length === 0 ? (
          <p className="muted">No points yet. Points appear here as soon as a reviewer accepts your work.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>What</th>
                <th>Details</th>
                <th className="right">Points</th>
              </tr>
            </thead>
            <tbody>
              {s.entries.map((e) => (
                <tr key={e.id}>
                  <td>{fmtDate(e.at)}</td>
                  <td>{TYPE_LABELS[e.type] ?? e.type}</td>
                  <td>{e.note ?? ""}</td>
                  <td className={`right ${e.points < 0 ? "neg" : "pos"}`}>
                    {e.points > 0 ? "+" : ""}
                    {e.points}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
