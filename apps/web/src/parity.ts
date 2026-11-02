/**
 * Runs every golden vector in this browser and compares exactly with the
 * committed expected output. Open /parity.html; the page prints PASS or the
 * first mismatch. Playwright opens it in Chromium, Firefox and WebKit.
 */
import { templates, vehicles } from "@mt/scenarios";
import { checkGolden, type DmathRow, type GoldenCase } from "@mt/sim-core";

const caseFiles = import.meta.glob<GoldenCase>("../../../packages/golden-vectors/cases/*.json", {
  eager: true,
  import: "default",
});
const expectedFiles = import.meta.glob<unknown>("../../../packages/golden-vectors/expected/*.json", {
  eager: true,
  import: "default",
});

const expected: Record<string, unknown> = {};
let dmathRows: DmathRow[] = [];
for (const [path, data] of Object.entries(expectedFiles)) {
  if (path.endsWith("/_dmath.json")) dmathRows = (data as { rows: DmathRow[] }).rows;
  else expected[(data as { name: string }).name] = data;
}

const { lines } = checkGolden({ cases: Object.values(caseFiles), expected, dmathRows, templates, vehicles });
document.getElementById("out")!.textContent = [`userAgent: ${navigator.userAgent}`, ...lines].join("\n");
