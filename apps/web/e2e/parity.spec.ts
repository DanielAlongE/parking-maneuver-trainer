import { expect, test } from "@playwright/test";

test("golden vectors match exactly in this browser", async ({ page }) => {
  await page.goto("/parity.html");
  const out = page.locator("#out");
  await expect(out).toContainText("RESULT:", { timeout: 30_000 });
  const text = (await out.textContent()) ?? "";
  console.log(text);
  expect(text, text).toContain("RESULT: PASS");
});
