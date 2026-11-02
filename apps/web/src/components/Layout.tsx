import { NavLink, Outlet, useNavigate } from "react-router";
import { hasRole, useAuth } from "../lib/auth";

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="app">
      <header className="topbar">
        <NavLink to="/" className="brand">
          Maneuver Trainer
        </NavLink>
        {user && (
          <nav className="mainnav" aria-label="Main">
            {hasRole(user, "annotator") && <NavLink to="/tasks">Tasks</NavLink>}
            {hasRole(user, "reviewer") && <NavLink to="/reviews">Reviews</NavLink>}
            <NavLink to="/points">Points</NavLink>
            <NavLink to="/practice">Practice</NavLink>
            {hasRole(user, "admin") && <NavLink to="/admin">Admin</NavLink>}
          </nav>
        )}
        {user && (
          <div className="who">
            <span className="muted">{user.displayName}</span>
            <button
              onClick={async () => {
                await logout();
                navigate("/login");
              }}
            >
              Sign out
            </button>
          </div>
        )}
      </header>
      <main>
        <Outlet />
      </main>
    </div>
  );
}

export function Pill({ status, label }: { status: string; label?: string }) {
  return <span className={`pill pill-${status}`}>{label ?? status}</span>;
}

export function ErrorNote({ error }: { error: string | null }) {
  if (!error) return null;
  return (
    <p className="error" role="alert">
      {error}
    </p>
  );
}
