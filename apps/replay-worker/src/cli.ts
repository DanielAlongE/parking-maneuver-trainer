/**
 * Replays one submission read from stdin and prints the result (without the
 * trajectory). Usage: pnpm replay < submission.json
 *
 * TODO(phase 1): consume jobs from the Redis queue, write results to
 * Postgres (replay_result) and trajectories to object storage.
 */
import { replay, type ReplayJob } from "./replay.js";

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  const job = JSON.parse(input) as ReplayJob;
  const { trajectory, ...summary } = replay(job);
  console.log(JSON.stringify({ ...summary, trajectorySteps: trajectory.length }, null, 2));
});
