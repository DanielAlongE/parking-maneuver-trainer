/** JSON client for the API. In development Vite proxies /api to the API server. */
import { useCallback, useEffect, useRef, useState } from "react";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function messageFrom(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const detail = (data as { detail?: unknown }).detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail) && detail[0] && typeof detail[0].msg === "string") {
    const loc = Array.isArray(detail[0].loc) ? detail[0].loc.filter((p: unknown) => p !== "body").join(".") : "";
    return loc ? `${loc}: ${detail[0].msg}` : detail[0].msg;
  }
  return null;
}

export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const hasBody = init.body !== undefined;
  const res = await fetch(`/api${path}`, {
    method: init.method ?? (hasBody ? "POST" : "GET"),
    headers: hasBody ? { "Content-Type": "application/json" } : undefined,
    body: hasBody ? JSON.stringify(init.body) : undefined,
    credentials: "same-origin",
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) throw new ApiError(res.status, messageFrom(data) ?? `Request failed (${res.status})`);
  return data as T;
}

/** Loads a GET endpoint; `reload` fetches again. */
export function useApi<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(path !== null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  const lastPath = useRef(path);

  useEffect(() => {
    if (path === null) return;
    let live = true;
    // A different resource: drop the old data so it is never shown as the new one.
    // A reload of the same resource keeps it on screen until the fresh copy arrives.
    if (lastPath.current !== path) {
      lastPath.current = path;
      setData(null);
      setError(null);
    }
    setLoading(true);
    api<T>(path)
      .then((d) => {
        if (live) {
          setData(d);
          setError(null);
        }
      })
      .catch((e: Error) => live && setError(e.message))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [path, tick]);

  return { data, error, loading, reload, setData };
}

// --- response types -----------------------------------------------------------------

export type Role = "annotator" | "reviewer" | "admin";

export interface User {
  id: string;
  email: string;
  displayName: string;
  roles: Role[];
}

export interface Assignment {
  id: string;
  status: string;
  taskId: string;
  templateId: string;
  seed: number;
  difficultyTier: number;
  defaultPoints: number;
  claimedAt: string;
  expiresAt: string;
}

export type SubmissionStatus = "pending_replay" | "pending_review" | "accepted" | "rejected";

export interface MySubmission {
  id: string;
  submittedAt: string;
  templateId: string;
  seed: number;
  outcome: "plan" | "unreachable";
  status: SubmissionStatus;
  goalReached: boolean | null;
  pointsAwarded: number | null;
  reviewerComment: string | null;
}

export interface Payout {
  id: string;
  points: number;
  cashAmountUsd: string;
  status: "requested" | "contacted" | "paid" | "cancelled";
  requestedAt: string;
  paidAt: string | null;
  externalReference: string | null;
  user?: string;
  email?: string;
}

export interface PointsSummary {
  balance: number;
  balanceUsd: string;
  minPayoutPoints: number;
  entries: { id: number; type: string; points: number; note: string | null; at: string }[];
  payouts: Payout[];
}
