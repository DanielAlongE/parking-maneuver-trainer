/**
 * Starts the replay worker.
 *   DATABASE_URL=... REDIS_URL=... pnpm --filter @mt/replay-worker start
 */
import { runWorker } from "./worker.js";

const controller = new AbortController();
for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => controller.abort());

await runWorker({
  databaseUrl: process.env.DATABASE_URL ?? "postgresql://mt:mt@localhost:5432/mt",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379/0",
  sweepIntervalMs: Number(process.env.SWEEP_INTERVAL_MS ?? 15000),
  signal: controller.signal,
});
