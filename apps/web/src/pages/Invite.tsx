import { useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router";
import { ErrorNote } from "../components/Layout";
import { api, useApi, type User } from "../lib/api";
import { homeFor, useAuth } from "../lib/auth";

const MIN_LENGTH = 10;

export function Invite() {
  const { token = "" } = useParams();
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const invite = useApi<{ email: string; displayName: string }>(`/auth/invites/${encodeURIComponent(token)}`);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < MIN_LENGTH) return setError(`Use at least ${MIN_LENGTH} characters.`);
    if (password !== confirm) return setError("The two passwords don't match.");
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ user: User }>(`/auth/invites/${encodeURIComponent(token)}/accept`, { body: { password } });
      setUser(r.user);
      navigate(homeFor(r.user), { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (invite.loading) return <p className="muted">Checking your invite…</p>;
  if (invite.error || !invite.data)
    return (
      <section className="panel narrow">
        <h1>Invite link not valid</h1>
        <p>{invite.error}</p>
      </section>
    );

  return (
    <section className="panel narrow">
      <h1>Welcome, {invite.data.displayName}</h1>
      <p className="muted">Set a password for {invite.data.email}.</p>
      <form onSubmit={submit} className="stack">
        <label>
          Password
          <input
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={MIN_LENGTH}
            required
          />
        </label>
        <label>
          Confirm password
          <input
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
        </label>
        <p className="hint">At least {MIN_LENGTH} characters.</p>
        <ErrorNote error={error} />
        <button className="primary" disabled={busy}>
          {busy ? "Saving…" : "Set password and sign in"}
        </button>
      </form>
    </section>
  );
}
