import { useState, type FormEvent } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router";
import { ErrorNote } from "../components/Layout";
import { api, type User } from "../lib/api";
import { homeFor, useAuth } from "../lib/auth";

export function Login() {
  const { user, setUser } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={params.get("next") || homeFor(user)} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ user: User }>("/auth/login", { body: { email, password } });
      setUser(r.user);
      navigate(params.get("next") || homeFor(r.user), { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="panel narrow">
      <h1>Sign in</h1>
      <form onSubmit={submit} className="stack">
        <label>
          Email
          <input type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        <ErrorNote error={error} />
        <button className="primary" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <p className="hint">Accounts are by invitation. Forgot your password? Ask an admin for a new invite link.</p>
    </section>
  );
}
