import { defineConfig, devices } from "@playwright/test";

/** The full-workflow test. Run through scripts/e2e.sh, which starts the services. */
export default defineConfig({
  testDir: "e2e-workflow",
  reporter: "list",
  timeout: 180_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:5177",
    ...devices["Desktop Chrome"],
    viewport: { width: 1280, height: 900 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium" }],
});
