/**
 * Golden-vector checks shared by the Node tests, the browser parity page and
 * the JavaScript engine shells (JavaScriptCore, SpiderMonkey). Plain
 * JavaScript only: no DOM and no Node APIs.
 */
import * as dmath from "./dmath.js";
import { instantiate } from "./instantiate.js";
import { simulate } from "./simulate.js";
import type { Plan, ScenarioTemplate, VehicleProfileSpec } from "./types.js";
import { SIM_VERSION } from "./version.js";

export interface GoldenCase {
  name: string;
  description: string;
  templateId: string;
  seed: number;
  /** Replaces the template's vehicle, so every vehicle profile is covered. */
  vehicleProfile?: string;
  plan: Plan;
}

export interface DmathRow {
  x: number;
  sin: number;
  cos: number;
  tan: number;
  normalizeAngle: number;
}

export function runGoldenCase(
  c: GoldenCase,
  templates: Record<string, ScenarioTemplate>,
  vehicles: Record<string, VehicleProfileSpec>,
) {
  const base = templates[c.templateId];
  if (!base) throw new Error(`Unknown template ${c.templateId}`);
  const template = c.vehicleProfile ? { ...base, vehicleProfile: c.vehicleProfile } : base;
  const instance = instantiate(template, c.seed, vehicles);
  return { simVersion: SIM_VERSION, name: c.name, instance, result: simulate(instance, c.plan) };
}

/**
 * Path to the first difference between two JSON values, or null.
 * Numbers compare with ===, so -0 equals 0: JSON cannot represent -0, and
 * both sides have been through a JSON round trip.
 */
export function firstDifference(a: unknown, b: unknown, path = "$"): string | null {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${path}: length ${a.length} != ${b.length}`;
    for (let i = 0; i < a.length; i++) {
      const d = firstDifference(a[i], b[i], `${path}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  if (a !== null && b !== null && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    if (ka.join() !== kb.join()) return `${path}: keys [${ka.join()}] != [${kb.join()}]`;
    for (const k of ka) {
      const d = firstDifference((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`);
      if (d) return d;
    }
    return null;
  }
  return a === b ? null : `${path}: ${String(a)} != ${String(b)}`;
}

export function checkGolden(input: {
  cases: GoldenCase[];
  /** Expected output files, keyed by case name. */
  expected: Record<string, unknown>;
  dmathRows: DmathRow[];
  templates: Record<string, ScenarioTemplate>;
  vehicles: Record<string, VehicleProfileSpec>;
}): { lines: string[]; failures: number } {
  const lines: string[] = [];
  let failures = 0;
  const cases = [...input.cases].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const c of cases) {
    let d: string | null;
    const exp = input.expected[c.name];
    if (exp === undefined) {
      d = "missing expected output";
    } else {
      try {
        const actual = JSON.parse(JSON.stringify(runGoldenCase(c, input.templates, input.vehicles)));
        d = firstDifference(actual, exp);
      } catch (e) {
        d = `error: ${String(e)}`;
      }
    }
    if (d) failures++;
    lines.push(`${d ? "FAIL" : "ok  "} ${c.name}${d ? `  ${d}` : ""}`);
  }
  const bad = input.dmathRows.filter(
    (r) =>
      dmath.sin(r.x) !== r.sin ||
      dmath.cos(r.x) !== r.cos ||
      dmath.tan(r.x) !== r.tan ||
      dmath.normalizeAngle(r.x) !== r.normalizeAngle,
  );
  if (bad.length) failures++;
  lines.push(
    `${bad.length ? "FAIL" : "ok  "} dmath (${input.dmathRows.length} inputs)${bad.length ? `  x = ${bad.map((r) => r.x).join(", ")}` : ""}`,
  );
  if (cases.length === 0) failures++;
  lines.push(failures ? `RESULT: FAIL (${failures})` : `RESULT: PASS (${cases.length} cases)`);
  return { lines, failures };
}
