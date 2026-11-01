import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dmathVectors, GOLDEN_DIR, loadCases, runCase } from "../scripts/golden.js";

/**
 * Re-runs every golden case and compares with the committed expected output
 * exactly (toStrictEqual on parsed JSON numbers, no tolerance).
 */
describe("golden vectors", () => {
  for (const c of loadCases()) {
    it(c.name, () => {
      const file = join(GOLDEN_DIR, "expected", `${c.name}.json`);
      expect(existsSync(file), `missing ${file}; run pnpm golden:generate`).toBe(true);
      const expected = JSON.parse(readFileSync(file, "utf8"));
      const actual = JSON.parse(JSON.stringify(runCase(c)));
      expect(actual).toStrictEqual(expected);
    });
  }

  it("dmath", () => {
    const expected = JSON.parse(readFileSync(join(GOLDEN_DIR, "expected", "_dmath.json"), "utf8"));
    expect(JSON.parse(JSON.stringify(dmathVectors()))).toStrictEqual(expected);
  });
});
