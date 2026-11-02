import { templates, vehicles } from "@mt/scenarios";
import { checkGolden, type DmathRow, type GoldenCase } from "../src/index.js";

declare const PARITY_DATA: { cases: GoldenCase[]; expected: Record<string, unknown>; dmathRows: DmathRow[] };
// JavaScript shells (jsc, gjs) print with print(); node uses console.log.
declare const print: ((line: string) => void) | undefined;

const out: (line: string) => void = typeof print === "function" ? print : (line) => console.log(line);
for (const line of checkGolden({ ...PARITY_DATA, templates, vehicles }).lines) out(line);
