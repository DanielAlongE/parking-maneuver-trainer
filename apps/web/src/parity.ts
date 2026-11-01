/**
 * Runs every golden vector in the browser and compares exactly with the
 * committed expected output. Open /parity.html in each target browser; the
 * page prints PASS or the first mismatch. Part of the phase 0 parity gate.
 */
import { templates, vehicles } from "@mt/scenarios";
import { dmath, instantiate, simulate, SIM_VERSION, type Plan } from "@mt/sim-core";

const cases = import.meta.glob<{ name: string; templateId: string; seed: number; plan: Plan }>(
  "../../../packages/golden-vectors/cases/*.json",
  { eager: true, import: "default" },
);
const expected = import.meta.glob<Record<string, unknown>>("../../../packages/golden-vectors/expected/*.json", {
  eager: true,
  import: "default",
});

function firstDiff(a: unknown, b: unknown, path = "$"): string | null {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${path}: length ${a.length} != ${b.length}`;
    for (let i = 0; i < a.length; i++) {
      const d = firstDiff(a[i], b[i], `${path}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a).sort();
    const kb = Object.keys(b).sort();
    if (ka.join() !== kb.join()) return `${path}: keys differ`;
    for (const k of ka) {
      const d = firstDiff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`);
      if (d) return d;
    }
    return null;
  }
  return a === b ? null : `${path}: ${String(a)} != ${String(b)}`;
}

const lines: string[] = [`userAgent: ${navigator.userAgent}`];
let failures = 0;
for (const [path, c] of Object.entries(cases)) {
  const exp = expected[path.replace("/cases/", "/expected/")];
  const instance = instantiate(templates[c.templateId]!, c.seed, vehicles);
  const actual = JSON.parse(JSON.stringify({ simVersion: SIM_VERSION, name: c.name, instance, result: simulate(instance, c.plan) }));
  const d = exp ? firstDiff(actual, exp) : "missing expected file";
  if (d) failures++;
  lines.push(`${d ? "FAIL" : "ok  "} ${c.name}${d ? `  ${d}` : ""}`);
}
const dm = expected[Object.keys(expected).find((k) => k.endsWith("/_dmath.json"))!] as {
  rows: { x: number; sin: number; cos: number; tan: number; normalizeAngle: number }[];
};
const dmBad = dm.rows.filter(
  (r) =>
    // === treats -0 and 0 as equal: JSON (and so the expected file) cannot
    // represent -0, matching the JSON round trip used by the Node tests.
    dmath.sin(r.x) !== r.sin ||
    dmath.cos(r.x) !== r.cos ||
    dmath.tan(r.x) !== r.tan ||
    dmath.normalizeAngle(r.x) !== r.normalizeAngle,
);
if (dmBad.length) failures++;
lines.push(`${dmBad.length ? "FAIL" : "ok  "} dmath (${dm.rows.length} inputs)${dmBad.map((r) => ` x=${r.x}`).join(",")}`);
lines.push(failures ? `RESULT: FAIL (${failures})` : "RESULT: PASS");
document.getElementById("out")!.textContent = lines.join("\n");
