/**
 * Regenerates golden-vectors/expected from the TypeScript core.
 * Run only when a change to simulation results is intended, then bump
 * SIM_VERSION and update the Python twin until its parity tests pass.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dmathVectors, GOLDEN_DIR, loadCases, runCase } from "./golden.js";

const outDir = join(GOLDEN_DIR, "expected");
mkdirSync(outDir, { recursive: true });

for (const c of loadCases()) {
  const out = runCase(c);
  writeFileSync(join(outDir, `${c.name}.json`), JSON.stringify(out) + "\n");
  const r = out.result;
  console.log(
    `${c.name.padEnd(36)} steps=${String(r.steps).padStart(4)} goal=${r.goalReached} collision=${r.collision?.withId ?? "-"}`,
  );
}
writeFileSync(join(outDir, "_dmath.json"), JSON.stringify(dmathVectors()) + "\n");
console.log("dmath vectors written");
