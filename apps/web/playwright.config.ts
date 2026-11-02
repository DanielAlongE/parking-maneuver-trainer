import { defineConfig, devices } from "@playwright/test";

/** Golden-vector parity in real browser engines (ADR phase 0 gate). */
export default defineConfig({
  testDir: "e2e",
  reporter: "list",
  timeout: 60_000,
  webServer: {
    command: "pnpm exec vite --port 5199 --strictPort",
    url: "http://localhost:5199/parity.html",
    reuseExistingServer: !process.env.CI,
  },
  use: { baseURL: "http://localhost:5199" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
