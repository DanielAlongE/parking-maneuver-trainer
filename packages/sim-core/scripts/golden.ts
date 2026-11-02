/**
 * Golden test vectors: fixed scenario + seed + plan cases whose results must be
 * bit-identical in the TypeScript core, the Python twin and every browser.
 *
 * cases/*.json     inputs, written by hand
 * expected/*.json  outputs, written by `pnpm golden:generate` from this core
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { templates, vehicles } from "@mt/scenarios";
import { dmath, runGoldenCase, SIM_VERSION, type DmathRow, type GoldenCase } from "../src/index.js";

export type { GoldenCase };

export const GOLDEN_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../golden-vectors");

function readJsonDir(dir: string): unknown[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json") && !f.startsWith("_"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
}

export function loadCases(): GoldenCase[] {
  return readJsonDir(join(GOLDEN_DIR, "cases")) as GoldenCase[];
}

/** Committed expected outputs, keyed by case name. */
export function loadExpected(): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const e of readJsonDir(join(GOLDEN_DIR, "expected")) as { name: string }[]) out[e.name] = e;
  return out;
}

export function loadDmathRows(): DmathRow[] {
  return JSON.parse(readFileSync(join(GOLDEN_DIR, "expected", "_dmath.json"), "utf8")).rows;
}

export function runCase(c: GoldenCase) {
  return runGoldenCase(c, templates, vehicles);
}

/** Inputs chosen to cover range reduction branches and large angles. */
export const DMATH_INPUTS = [
  0, 1e-9, 0.1, 0.5, 1, 1.2345, 1.57, 2, 3, 3.141592653589793, 4, 5, 6, 7.5, 10, 100, -0.1,
  -1, -2.5, -3.141592653589793, -4, -10, -100, 0.6108652381980153, -0.6108652381980153,
];

export function dmathVectors() {
  return {
    simVersion: SIM_VERSION,
    rows: DMATH_INPUTS.map((x) => ({
      x,
      sin: dmath.sin(x),
      cos: dmath.cos(x),
      tan: dmath.tan(x),
      normalizeAngle: dmath.normalizeAngle(x),
    })),
  };
}
