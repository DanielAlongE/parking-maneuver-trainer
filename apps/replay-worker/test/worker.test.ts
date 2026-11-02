/**
 * Integration test against real Postgres and Redis. Skipped unless set:
 *   TEST_WORKER_DATABASE_URL=postgresql://... TEST_REDIS_URL=redis://... pnpm test
 * The database's public schema is dropped and rebuilt from apps/api/migrations.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { createClient } from "redis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { processSubmission, QUEUE_KEY, runWorker, sweep } from "../src/worker.js";

const DB = process.env.TEST_WORKER_DATABASE_URL;
const REDIS = process.env.TEST_REDIS_URL;
const MIGRATIONS = fileURLToPath(new URL("../../api/migrations", import.meta.url));
const GOLDEN = fileURLToPath(new URL("../../../packages/golden-vectors", import.meta.url));

const reference = JSON.parse(readFileSync(join(GOLDEN, "cases/parallel-park-reference.json"), "utf8"));
const collision = JSON.parse(readFileSync(join(GOLDEN, "cases/parallel-park-collision.json"), "utf8"));
const referenceExpected = JSON.parse(readFileSync(join(GOLDEN, "expected/parallel-park-reference.json"), "utf8"));

describe.skipIf(!DB || !REDIS)("replay worker with Postgres and Redis", () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: DB });
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    for (const f of readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql")).sort()) {
      await pool.query(readFileSync(join(MIGRATIONS, f), "utf8"));
    }
    await pool.query(
      `INSERT INTO scenario_templates (id, schema_version, family, difficulty_tier, body)
       VALUES ('parallel-park-kerbside', '1.0', 'parking', 2, '{}')`,
    );
    await pool.query(`INSERT INTO users (email, display_name) VALUES ('ann@test', 'Ann')`);
  });

  afterAll(async () => {
    await pool?.end();
  });

  async function makeSubmission(seed: number, segments: unknown[], clientGoal: boolean | null = null): Promise<string> {
    const inst = await pool.query(
      `INSERT INTO scenario_instances (template_id, schema_version, seed, params, content_hash)
       VALUES ('parallel-park-kerbside', '1.0', $1, '{}', gen_random_uuid()::text) RETURNING id`,
      [seed],
    );
    const task = await pool.query(`INSERT INTO tasks (instance_id) VALUES ($1) RETURNING id`, [inst.rows[0].id]);
    const a = await pool.query(
      `INSERT INTO assignments (task_id, annotator_id, status)
       SELECT $1, id, 'submitted' FROM users WHERE email = 'ann@test' RETURNING id`,
      [task.rows[0].id],
    );
    const s = await pool.query(
      `INSERT INTO submissions (assignment_id, sim_version, outcome, actions, confidence, client_result)
       VALUES ($1, '0.1.0', 'plan', $2, 3, $3) RETURNING id`,
      [a.rows[0].id, JSON.stringify(segments), clientGoal === null ? null : JSON.stringify({ goalReached: clientGoal })],
    );
    return s.rows[0].id;
  }

  const result = async (id: string) =>
    (await pool.query(`SELECT *, flags::text[] AS flags FROM replay_results WHERE submission_id = $1`, [id])).rows[0];

  it("writes the same metrics as the golden vector, once", async () => {
    const id = await makeSubmission(reference.seed, reference.plan.segments, true);
    expect(await processSubmission(pool, id)).toBe(true);
    expect(await processSubmission(pool, id)).toBe(false);
    const r = await result(id);
    const exp = referenceExpected.result;
    expect(r.valid).toBe(true);
    expect(r.goal_reached).toBe(true);
    expect(r.final_position_error_m).toBe(exp.finalPositionErrorM);
    expect(r.min_clearance_static_m).toBe(exp.minClearanceStaticM);
    expect(r.flags).toEqual([]);
    expect(r.client_mismatch).toBe(false);
  });

  it("flags collisions and client/server disagreement", async () => {
    const id = await makeSubmission(collision.seed, collision.plan.segments, true);
    await processSubmission(pool, id);
    const r = await result(id);
    expect(r.valid).toBe(false);
    expect(r.collision.withId).toBe("kerb-right");
    expect(r.flags).toEqual(expect.arrayContaining(["collision", "goal_not_reached", "client_server_mismatch"]));
  });

  it("sweeps submissions that never reached the queue", async () => {
    const id = await makeSubmission(reference.seed, reference.plan.segments);
    expect(await sweep(pool)).toBe(1);
    expect((await result(id)).valid).toBe(true);
  });

  it("consumes jobs from Redis", async () => {
    const id = await makeSubmission(reference.seed, reference.plan.segments);
    const redis = createClient({ url: REDIS });
    await redis.connect();
    await redis.del(QUEUE_KEY);
    const controller = new AbortController();
    const running = runWorker({
      databaseUrl: DB!,
      redisUrl: REDIS!,
      sweepIntervalMs: 3_600_000,
      initialSweep: false,
      signal: controller.signal,
      log: () => {},
    });
    // No sweeps run, so only the queue can deliver this job.
    await redis.lPush(QUEUE_KEY, JSON.stringify({ submissionId: id }));
    let r;
    for (let i = 0; i < 50 && !r; i++) {
      await new Promise((res) => setTimeout(res, 100));
      r = await result(id);
    }
    controller.abort();
    await running;
    await redis.quit();
    expect(r?.valid).toBe(true);
  }, 20_000);
});
