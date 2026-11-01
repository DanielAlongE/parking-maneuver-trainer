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
import { dmath, instantiate, simulate, SIM_VERSION, type Plan } from "../src/index.js";

export const GOLDEN_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../golden-vectors");

export interface GoldenCase {
  name: string;
  description: string;
  templateId: string;
  seed: number;
  plan: Plan;
}

export function loadCases(): GoldenCase[] {
  const dir = join(GOLDEN_DIR, "cases");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as GoldenCase);
}

export function runCase(c: GoldenCase) {
  const template = templates[c.templateId];
  if (!template) throw new Error(`Unknown template ${c.templateId}`);
  const instance = instantiate(template, c.seed, vehicles);
  const result = simulate(instance, c.plan);
  return { simVersion: SIM_VERSION, name: c.name, instance, result };
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
