import { templates } from "@mt/scenarios";
import { useState, type FormEvent } from "react";
import { NavLink, Outlet } from "react-router";
import { ErrorNote, Pill } from "../../components/Layout";
import { api, useApi, type Payout, type Role, type User } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { fmtDate, STATUS_LABELS, templateTitle } from "../../lib/plan";

export function AdminLayout() {
  return (
    <div className="stack">
      <nav className="subnav" aria-label="Admin">
        <NavLink to="/admin" end>
          Overview
        </NavLink>
        <NavLink to="/admin/users">Users</NavLink>
        <NavLink to="/admin/claims">Expired claims</NavLink>
        <NavLink to="/admin/reviews">Review batches</NavLink>
        <NavLink to="/admin/payouts">Payouts</NavLink>
      </nav>
      <Outlet />
    </div>
  );
}

/** Runs an action, tracking busy and error state. */
function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

// --- overview --------------------------------------------------------------------------------

interface Overview {
  tasks: { total: number; available: number; claimed: number; expired: number };
  submissions: { awaitingReplay: number; unassigned: number; awaitingReview: number; accepted: number; rejected: number };
  openPayouts: number;
  templates: { templateId: string; tasks: number; accepted: number }[];
}

export function AdminOverview() {
  const o = useApi<Overview>("/admin/overview");
  const [templateId, setTemplateId] = useState("parallel-park-kerbside");
  const [count, setCount] = useState(20);
  const [seedText, setSeedText] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const act = useAction();

  const generate = (e: FormEvent) => {
    e.preventDefault();
    act.run(async () => {
      const seeds = seedText
        .split(/[\s,]+/)
        .filter(Boolean)
        .map(Number);
      if (seeds.some((n) => !Number.isInteger(n) || n < 0)) throw new Error("Seeds must be whole numbers, 0 or more");
      const body = seeds.length ? { templateId, seeds } : { templateId, count };
      const r = await api<{ created: number }>("/admin/tasks/generate", { body });
      setCreated(`Created ${r.created} ${templateTitle(templateId)} tasks.`);
      o.reload();
    });
  };

  const d = o.data;
  return (
    <div className="stack-lg">
      {d && (
        <div className="stats">
          <Stat label="Tasks available" value={d.tasks.available} sub={`of ${d.tasks.total}`} />
          <Stat label="Claimed now" value={d.tasks.claimed} />
          <Stat label="Expired claims" value={d.tasks.expired} link={d.tasks.expired ? "/admin/claims" : undefined} />
          <Stat label="Need a reviewer" value={d.submissions.unassigned} link={d.submissions.unassigned ? "/admin/reviews" : undefined} />
          <Stat label="Awaiting review" value={d.submissions.awaitingReview} />
          <Stat label="Accepted" value={d.submissions.accepted} sub={`${d.submissions.rejected} rejected`} />
          <Stat label="Open payouts" value={d.openPayouts} link={d.openPayouts ? "/admin/payouts" : undefined} />
        </div>
      )}
      <ErrorNote error={o.error} />
      <div className="columns">
        <section className="panel">
          <h2>Tasks by scenario</h2>
          {d && d.templates.length === 0 ? (
            <p className="muted">No tasks yet. Generate some to open the queue.</p>
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Scenario</th>
                  <th className="right">Tasks</th>
                  <th className="right">Accepted labels</th>
                </tr>
              </thead>
              <tbody>
                {d?.templates.map((t) => (
                  <tr key={t.templateId}>
                    <td>{templateTitle(t.templateId)}</td>
                    <td className="right">{t.tasks}</td>
                    <td className="right">{t.accepted}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
        <section className="panel">
          <h2>Generate tasks</h2>
          <form onSubmit={generate} className="stack">
            <label>
              Scenario
              <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                {Object.values(templates).map((t) => (
                  <option key={t.templateId} value={t.templateId}>
                    {t.title} (tier {t.difficultyTier})
                  </option>
                ))}
              </select>
            </label>
            <label>
              How many (each gets a random seed)
              <input
                type="number"
                min={1}
                max={500}
                value={count}
                disabled={seedText.trim() !== ""}
                onChange={(e) => setCount(Number(e.target.value))}
              />
            </label>
            <label>
              Or specific seeds (comma-separated, optional)
              <input value={seedText} onChange={(e) => setSeedText(e.target.value)} placeholder="e.g. 7, 1234" />
            </label>
            <button className="primary" disabled={act.busy}>
              Generate
            </button>
            <ErrorNote error={act.error} />
            {created && <p className="notice">{created}</p>}
          </form>
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, link }: { label: string; value: number; sub?: string; link?: string }) {
  const body = (
    <>
      <span className="stat-value">{value}</span>
      <span className="stat-label">{label}</span>
      {sub && <span className="muted small">{sub}</span>}
    </>
  );
  return link ? (
    <NavLink to={link} className="stat linked">
      {body}
    </NavLink>
  ) : (
    <div className="stat">{body}</div>
  );
}

// --- users -------------------------------------------------------------------------------------

interface AdminUser extends User {
  active: boolean;
  hasPassword: boolean;
  balance: number;
  createdAt: string;
}

const ALL_ROLES: Role[] = ["annotator", "reviewer", "admin"];

export function AdminUsers() {
  const { user: me } = useAuth();
  const users = useApi<{ users: AdminUser[] }>("/admin/users");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [roles, setRoles] = useState<Role[]>(["annotator"]);
  const [link, setLink] = useState<{ who: string; url: string } | null>(null);
  const act = useAction();

  const invite = (e: FormEvent) => {
    e.preventDefault();
    act.run(async () => {
      const r = await api<{ inviteUrl: string }>("/admin/users", { body: { email, displayName: name, roles } });
      setLink({ who: email, url: r.inviteUrl });
      setEmail("");
      setName("");
      users.reload();
    });
  };
  const patch = (u: AdminUser, body: object) =>
    act.run(async () => {
      await api(`/admin/users/${u.id}`, { method: "PATCH", body });
      users.reload();
    });
  const newLink = (u: AdminUser) =>
    act.run(async () => {
      const r = await api<{ inviteUrl: string }>(`/admin/users/${u.id}/invite`, { method: "POST" });
      setLink({ who: u.email, url: r.inviteUrl });
    });

  return (
    <div className="stack-lg">
      <section className="panel">
        <h2>Invite someone</h2>
        <form onSubmit={invite} className="row gap wrap end">
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </label>
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} />
          </label>
          <fieldset className="roles">
            <legend>Roles</legend>
            {ALL_ROLES.map((r) => (
              <label key={r} className="row gap-sm">
                <input
                  type="checkbox"
                  checked={roles.includes(r)}
                  onChange={(e) => setRoles(e.target.checked ? [...roles, r] : roles.filter((x) => x !== r))}
                />
                {r}
              </label>
            ))}
          </fieldset>
          <button className="primary" disabled={act.busy || roles.length === 0}>
            Create invite
          </button>
        </form>
        {link && (
          <div className="notice">
            Send this one-time link to {link.who} (valid 7 days):
            <div className="row gap">
              <code className="link">{link.url}</code>
              <button onClick={() => navigator.clipboard?.writeText(link.url)}>Copy</button>
            </div>
          </div>
        )}
        <ErrorNote error={act.error} />
      </section>

      <section className="panel">
        <h2>Users</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              {ALL_ROLES.map((r) => (
                <th key={r}>{r}</th>
              ))}
              <th className="right">Points</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.data?.users.map((u) => (
              <tr key={u.id} className={u.active ? "" : "inactive"}>
                <td>{u.displayName}</td>
                <td>{u.email}</td>
                {ALL_ROLES.map((r) => (
                  <td key={r}>
                    <input
                      type="checkbox"
                      aria-label={`${u.displayName} ${r}`}
                      checked={u.roles.includes(r)}
                      disabled={act.busy || (u.id === me?.id && r === "admin")}
                      onChange={(e) => {
                        const next = e.target.checked ? [...u.roles, r] : u.roles.filter((x) => x !== r);
                        if (next.length) patch(u, { roles: next });
                      }}
                    />
                  </td>
                ))}
                <td className="right">{u.balance}</td>
                <td>{!u.active ? "Deactivated" : u.hasPassword ? "Active" : "Invited"}</td>
                <td className="row gap-sm right">
                  {u.active && <button onClick={() => newLink(u)}>{u.hasPassword ? "Reset link" : "New invite"}</button>}
                  {u.id !== me?.id && (
                    <button onClick={() => patch(u, { active: !u.active })}>{u.active ? "Deactivate" : "Reactivate"}</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <ErrorNote error={users.error} />
      </section>
    </div>
  );
}

// --- expired claims -----------------------------------------------------------------------

interface Claim {
  id: string;
  annotator: string;
  annotatorEmail: string;
  templateId: string;
  claimedAt: string;
  expiresAt: string;
}

export function AdminClaims() {
  const claims = useApi<{ claims: Claim[] }>("/admin/claims?status=expired");
  const [picked, setPicked] = useState<string[]>([]);
  const act = useAction();
  const list = claims.data?.claims ?? [];

  const reset = (ids: string[]) =>
    act.run(async () => {
      await api("/admin/claims/reset", { body: { assignmentIds: ids } });
      setPicked([]);
      claims.reload();
    });

  return (
    <section className="panel">
      <div className="row between wrap">
        <h2>Expired claims</h2>
        <div className="row gap">
          <button disabled={!picked.length || act.busy} onClick={() => reset(picked)}>
            Reset selected ({picked.length})
          </button>
          <button className="primary" disabled={!list.length || act.busy} onClick={() => reset(list.map((c) => c.id))}>
            Reset all
          </button>
        </div>
      </div>
      <p className="muted">
        Tasks whose 24-hour claim ran out stay out of the queue until reset. Resetting returns them to the queue for anyone.
      </p>
      {list.length === 0 ? (
        <p className="muted">No expired claims.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th />
              <th>Annotator</th>
              <th>Scenario</th>
              <th>Claimed</th>
              <th>Expired</th>
            </tr>
          </thead>
          <tbody>
            {list.map((c) => (
              <tr key={c.id}>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Select claim by ${c.annotator}`}
                    checked={picked.includes(c.id)}
                    onChange={(e) => setPicked(e.target.checked ? [...picked, c.id] : picked.filter((x) => x !== c.id))}
                  />
                </td>
                <td>{c.annotator}</td>
                <td>{templateTitle(c.templateId)}</td>
                <td>{fmtDate(c.claimedAt)}</td>
                <td>{fmtDate(c.expiresAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <ErrorNote error={act.error ?? claims.error} />
    </section>
  );
}

// --- review batches ------------------------------------------------------------------------

interface Unassigned {
  id: string;
  submittedAt: string;
  outcome: string;
  annotatorId: string;
  templateId: string;
  valid: boolean;
  flags: string[];
}

export function AdminReviews() {
  const users = useApi<{ users: AdminUser[] }>("/admin/users");
  const pending = useApi<{ submissions: Unassigned[] }>("/admin/submissions/unassigned");
  const batches = useApi<{ batches: { id: string; reviewer: string; createdAt: string; size: number; done: number }[] }>(
    "/admin/review-batches",
  );
  const reviewers = (users.data?.users ?? []).filter((u) => u.active && u.roles.includes("reviewer"));
  const [reviewerId, setReviewerId] = useState("");
  const [count, setCount] = useState(10);
  const [picked, setPicked] = useState<string[]>([]);
  const [made, setMade] = useState<string | null>(null);
  const act = useAction();
  const subs = pending.data?.submissions ?? [];
  const chosenReviewer = reviewerId || reviewers[0]?.id || "";

  const create = (body: object) =>
    act.run(async () => {
      const r = await api<{ size: number }>("/admin/review-batches", { body: { reviewerId: chosenReviewer, ...body } });
      const who = reviewers.find((u) => u.id === chosenReviewer)?.displayName;
      setMade(`Assigned ${r.size} submission${r.size === 1 ? "" : "s"} to ${who}.`);
      setPicked([]);
      pending.reload();
      batches.reload();
    });

  return (
    <div className="stack-lg">
      <section className="panel">
        <h2>Assign reviews</h2>
        <p className="muted">
          {subs.length} scored submission{subs.length === 1 ? "" : "s"} waiting for a reviewer. Reviewers never get their own work.
        </p>
        {reviewers.length === 0 ? (
          <p className="muted">No reviewers yet. Give someone the reviewer role on the Users page.</p>
        ) : (
          <div className="row gap wrap end">
            <label>
              Reviewer
              <select value={chosenReviewer} onChange={(e) => setReviewerId(e.target.value)}>
                {reviewers.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Batch size
              <input type="number" min={1} max={500} value={count} onChange={(e) => setCount(Number(e.target.value))} />
            </label>
            <button className="primary" disabled={act.busy || !subs.length} onClick={() => create({ count })}>
              Assign oldest {Math.min(count, subs.length)}
            </button>
            <button disabled={act.busy || !picked.length} onClick={() => create({ submissionIds: picked })}>
              Assign selected ({picked.length})
            </button>
          </div>
        )}
        {made && <p className="notice">{made}</p>}
        <ErrorNote error={act.error} />
        {subs.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th />
                <th>Scenario</th>
                <th>Type</th>
                <th>Server check</th>
                <th>Submitted</th>
              </tr>
            </thead>
            <tbody>
              {subs.map((s) => (
                <tr key={s.id}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label="Select submission"
                      checked={picked.includes(s.id)}
                      onChange={(e) => setPicked(e.target.checked ? [...picked, s.id] : picked.filter((x) => x !== s.id))}
                    />
                  </td>
                  <td>{templateTitle(s.templateId)}</td>
                  <td>{s.outcome === "plan" ? "Plan" : "Unreachable"}</td>
                  <td>{s.flags.length ? s.flags.join(", ") : "Clean"}</td>
                  <td>{fmtDate(s.submittedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section className="panel">
        <h2>Batches</h2>
        {batches.data?.batches.length ? (
          <table className="table">
            <thead>
              <tr>
                <th>Reviewer</th>
                <th>Created</th>
                <th className="right">Done</th>
              </tr>
            </thead>
            <tbody>
              {batches.data.batches.map((b) => (
                <tr key={b.id}>
                  <td>{b.reviewer}</td>
                  <td>{fmtDate(b.createdAt)}</td>
                  <td className="right">
                    {b.done} / {b.size}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No batches yet.</p>
        )}
      </section>
    </div>
  );
}

// --- payouts ---------------------------------------------------------------------------------

export function AdminPayouts() {
  const [scope, setScope] = useState<"open" | "all">("open");
  const payouts = useApi<{ payouts: Payout[] }>(`/admin/payouts?status=${scope}`);
  const [refs, setRefs] = useState<Record<string, string>>({});
  const act = useAction();

  const update = (p: Payout, status: string) =>
    act.run(async () => {
      await api(`/admin/payouts/${p.id}`, { body: { status, externalReference: refs[p.id] ?? null } });
      payouts.reload();
    });

  return (
    <section className="panel">
      <div className="row between wrap">
        <h2>Payouts</h2>
        <div className="row gap">
          <button className={scope === "open" ? "primary" : ""} onClick={() => setScope("open")}>
            Open
          </button>
          <button className={scope === "all" ? "primary" : ""} onClick={() => setScope("all")}>
            All
          </button>
        </div>
      </div>
      <p className="muted">
        Email the person to arrange payment, then record the payment reference. Cancelling returns the points to their balance.
      </p>
      {payouts.data?.payouts.length === 0 ? (
        <p className="muted">No {scope === "open" ? "open " : ""}payout requests.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Requested</th>
              <th>Person</th>
              <th className="right">Points</th>
              <th className="right">Amount</th>
              <th>Status</th>
              <th>Payment reference</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {payouts.data?.payouts.map((p) => {
              const open = p.status === "requested" || p.status === "contacted";
              return (
                <tr key={p.id}>
                  <td>{fmtDate(p.requestedAt)}</td>
                  <td>
                    {p.user}
                    <br />
                    <a href={`mailto:${p.email}?subject=${encodeURIComponent("Your Maneuver Trainer payout")}`}>{p.email}</a>
                  </td>
                  <td className="right">{p.points}</td>
                  <td className="right">${p.cashAmountUsd}</td>
                  <td>
                    <Pill status={p.status} label={STATUS_LABELS[p.status]} />
                  </td>
                  <td>
                    {open ? (
                      <input
                        aria-label="Payment reference"
                        placeholder="e.g. e-Transfer ref"
                        value={refs[p.id] ?? ""}
                        onChange={(e) => setRefs({ ...refs, [p.id]: e.target.value })}
                      />
                    ) : (
                      p.externalReference ?? ""
                    )}
                  </td>
                  <td className="row gap-sm right">
                    {p.status === "requested" && <button onClick={() => update(p, "contacted")}>Contacted</button>}
                    {open && (
                      <button className="primary" disabled={!refs[p.id]?.trim()} onClick={() => update(p, "paid")}>
                        Mark paid
                      </button>
                    )}
                    {open && (
                      <button className="danger" onClick={() => update(p, "cancelled")}>
                        Cancel
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <ErrorNote error={act.error ?? payouts.error} />
    </section>
  );
}
