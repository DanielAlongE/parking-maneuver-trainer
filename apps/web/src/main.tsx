import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { Layout } from "./components/Layout";
import { AuthProvider, homeFor, RequireRole, useAuth } from "./lib/auth";
import { AdminClaims, AdminLayout, AdminOverview, AdminPayouts, AdminReviews, AdminUsers } from "./pages/admin/Admin";
import { Invite } from "./pages/Invite";
import { Login } from "./pages/Login";
import { Points } from "./pages/Points";
import { Practice } from "./pages/Practice";
import { ReviewItemPage, ReviewQueue } from "./pages/Reviews";
import { TaskPage } from "./pages/TaskPage";
import { Tasks } from "./pages/Tasks";
import "./styles.css";

function Home() {
  const { user, loading } = useAuth();
  if (loading) return <p className="muted">Loading…</p>;
  return <Navigate to={user ? homeFor(user) : "/login"} replace />;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="login" element={<Login />} />
            <Route path="invite/:token" element={<Invite />} />
            <Route path="tasks" element={<RequireRole role="annotator"><Tasks /></RequireRole>} />
            <Route path="task" element={<RequireRole role="annotator"><TaskPage /></RequireRole>} />
            <Route path="points" element={<RequireRole><Points /></RequireRole>} />
            <Route path="practice" element={<RequireRole><Practice /></RequireRole>} />
            <Route path="reviews" element={<RequireRole role="reviewer"><ReviewQueue /></RequireRole>} />
            <Route path="reviews/:id" element={<RequireRole role="reviewer"><ReviewItemPage /></RequireRole>} />
            <Route path="admin" element={<RequireRole role="admin"><AdminLayout /></RequireRole>}>
              <Route index element={<AdminOverview />} />
              <Route path="users" element={<AdminUsers />} />
              <Route path="claims" element={<AdminClaims />} />
              <Route path="reviews" element={<AdminReviews />} />
              <Route path="payouts" element={<AdminPayouts />} />
            </Route>
            <Route path="*" element={<p className="muted">Page not found.</p>} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
