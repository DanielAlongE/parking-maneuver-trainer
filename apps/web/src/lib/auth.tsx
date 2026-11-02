import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import { api, ApiError, type Role, type User } from "./api";

interface AuthState {
  user: User | null;
  loading: boolean;
  setUser: (u: User | null) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<{ user: User }>("/auth/me")
      .then((r) => setUser(r.user))
      .catch((e) => {
        if (!(e instanceof ApiError && e.status === 401)) console.error(e);
        setUser(null);
      })
      .finally(() => setLoading(false));
  }, []);

  const logout = useCallback(async () => {
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    setUser(null);
  }, []);

  return <AuthContext.Provider value={{ user, loading, setUser, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth outside AuthProvider");
  return ctx;
}

export function hasRole(user: User | null, role: Role): boolean {
  return !!user && user.roles.includes(role);
}

/** Renders children only for a signed-in user with the role. */
export function RequireRole({ role, children }: { role?: Role; children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <p className="muted">Loading…</p>;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  if (role && !user.roles.includes(role)) {
    return (
      <section className="panel">
        <h2>Not available</h2>
        <p className="muted">This page needs the {role} role. Ask an admin if you think you should have it.</p>
      </section>
    );
  }
  return <>{children}</>;
}

/** Where a user lands after signing in. */
export function homeFor(user: User): string {
  if (user.roles.includes("annotator")) return "/tasks";
  if (user.roles.includes("reviewer")) return "/reviews";
  return "/admin";
}
