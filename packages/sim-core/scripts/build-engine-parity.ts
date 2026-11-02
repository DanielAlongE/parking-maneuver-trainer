/**
 * Bundles the golden-vector check and its data into one plain script,
 * dist/engine-parity.js, that runs in any JavaScript shell:
 * jsc (JavaScriptCore, Safari's engine), gjs (SpiderMonkey, Firefox's engine)
 * and node (V8, Chrome's engine).
 */
import { build } from "esbuild";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadCases, loadDmathRows, loadExpected } from "./golden.js";

const here = dirname(fileURLToPath(import.meta.url));
const outFile = join(here, "../dist/engine-parity.js");

const data = { cases: loadCases(), expected: loadExpected(), dmathRows: loadDmathRows() };
const result = await build({
  entryPoints: [join(here, "engine-parity-entry.ts")],
  bundle: true,
  format: "iife",
  platform: "neutral",
  mainFields: ["module", "main"],
  target: "es2020",
  write: false,
});

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, `var PARITY_DATA = ${JSON.stringify(data)};\n${result.outputFiles[0]!.text}`);
console.log(`wrote ${outFile} (${data.cases.length} cases)`);
