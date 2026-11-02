/**
 * Replay worker: takes submission ids from the Redis queue (the API pushes one
 * per submission), replays each with @mt/sim-core and writes replay_results.
 * It also sweeps Postgres for submissions without a result, so a job lost in
 * Redis only delays scoring. Writing is idempotent (one row per submission).
 */
import pg from "pg";
import { createClient } from "redis";
import { replay, type ReplayJob } from "./replay.js";

export const QUEUE_KEY = "mt:replay-jobs";

const LOAD_SQL = `
  SELECT s.id, s.sim_version, s.outcome::text AS outcome, s.actions, s.client_result,
         i.template_id, i.seed
  FROM submissions s
  JOIN assignments a ON a.id = s.assignment_id
  JOIN tasks t ON t.id = a.task_id
  JOIN scenario_instances i ON i.id = t.instance_id
  WHERE s.id = $1
    AND NOT EXISTS (SELECT 1 FROM replay_results rr WHERE rr.submission_id = s.id)`;

const INSERT_SQL = `
  INSERT INTO replay_results (
    submission_id, sim_version, valid, goal_reached, collision, final_position_error_m,
    final_heading_error_deg, min_clearance_static_m, min_clearance_agents_m, direction_changes,
    duration_s, steering_smoothness, planner_solvable, client_mismatch, flags, trajectory_uri)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NULL, $13, $14, NULL)
  ON CONFLICT (submission_id) DO NOTHING`;

const UNREPLAYED_SQL = `
  SELECT s.id FROM submissions s
  WHERE NOT EXISTS (SELECT 1 FROM replay_results rr WHERE rr.submission_id = s.id)
  ORDER BY s.created_at LIMIT $1`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Log = (msg: string) => void;

/** Replays one submission. Returns false if it doesn't exist or already has a result. */
export async function processSubmission(pool: pg.Pool, submissionId: string, log: Log = () => {}): Promise<boolean> {
  if (!UUID_RE.test(submissionId)) {
    log(`skip: not a submission id: ${submissionId}`);
    return false;
  }
  const { rows } = await pool.query(LOAD_SQL, [submissionId]);
  const s = rows[0];
  if (!s) return false;
  const job: ReplayJob = {
    submissionId: s.id,
    simVersion: s.sim_version,
    templateId: s.template_id,
    seed: Number(s.seed),
    outcome: s.outcome,
    actions: s.actions ?? [],
    clientResult: s.client_result,
  };
  const r = replay(job);
  const res = await pool.query(INSERT_SQL, [
    r.submissionId,
    r.simVersion,
    r.valid,
    r.goalReached,
    r.collision ? JSON.stringify(r.collision) : null,
    r.finalPositionErrorM,
    r.finalHeadingErrorDeg,
    r.minClearanceStaticM,
    r.minClearanceAgentsM,
    r.directionChanges,
    r.durationS,
    r.steeringSmoothnessDegPerS,
    r.clientMismatch,
    r.flags,
  ]);
  log(`replayed ${submissionId}: valid=${r.valid} flags=[${r.flags.join(",")}]`);
  return (res.rowCount ?? 0) > 0;
}

/** Replays every submission that has no result yet (up to `limit`). */
export async function sweep(pool: pg.Pool, log: Log = () => {}, limit = 100): Promise<number> {
  const { rows } = await pool.query(UNREPLAYED_SQL, [limit]);
  let n = 0;
  for (const row of rows) {
    try {
      if (await processSubmission(pool, row.id, log)) n++;
    } catch (e) {
      log(`error replaying ${row.id}: ${String(e)}`);
    }
  }
  return n;
}

export interface WorkerOptions {
  databaseUrl: string;
  redisUrl: string;
  sweepIntervalMs?: number;
  /** Sweep once on start (default true). */
  initialSweep?: boolean;
  signal?: AbortSignal;
  log?: Log;
}

export async function runWorker(opts: WorkerOptions): Promise<void> {
  const log = opts.log ?? ((m: string) => console.log(`[replay-worker] ${m}`));
  const pool = new pg.Pool({ connectionString: opts.databaseUrl, max: 4 });
  const redis = createClient({ url: opts.redisUrl });
  redis.on("error", (e) => log(`redis error: ${String(e)}`));
  await redis.connect();
  const sweepEvery = opts.sweepIntervalMs ?? 15_000;
  let lastSweep = opts.initialSweep === false ? Date.now() : 0;
  log("started");
  try {
    while (!opts.signal?.aborted) {
      if (Date.now() - lastSweep >= sweepEvery) {
        const n = await sweep(pool, log).catch((e) => (log(`sweep failed: ${String(e)}`), 0));
        if (n) log(`sweep replayed ${n}`);
        lastSweep = Date.now();
      }
      let item: { key: string; element: string } | null = null;
      try {
        item = await redis.brPop(QUEUE_KEY, 2);
      } catch (e) {
        if (opts.signal?.aborted) break;
        log(`queue read failed: ${String(e)}`);
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      if (!item) continue;
      let id = "";
      try {
        id = String(JSON.parse(item.element).submissionId ?? "");
        await processSubmission(pool, id, log);
      } catch (e) {
        // Left without a result; the next sweep retries it.
        log(`error replaying ${id || item.element}: ${String(e)}`);
      }
    }
  } finally {
    log("stopping");
    await redis.quit().catch(() => {});
    await pool.end();
  }
}
