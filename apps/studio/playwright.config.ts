/**
 * Playwright for end-to-end flows (contracts §1: K2, then frozen). `e2e/_support/global-setup.ts` (Q0)
 * builds the app with `VITE_STUDIO_E2E=1` into `dist-e2e-<PLAYWRIGHT_PORT>` and serves it on this
 * worktree's `PLAYWRIGHT_PORT`; until Q0 lands, K2's stub serves the dev app there. The output folder
 * carries the port, because Playwright empties it at the start of every run and helpers share a worktree.
 */
import { defineConfig, devices } from "@playwright/test";
import { localPort } from "./local-env.ts";

const port = localPort("PLAYWRIGHT_PORT");

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  outputDir: `test-results/${port}`,
  globalSetup: "./e2e/_support/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { outputFolder: `playwright-report/${port}`, open: "never" }]],
  use: {
    baseURL: `http://localhost:${port}`,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    {
      // The Safari smoke set: specs tagged @smoke.
      name: "webkit-smoke",
      grep: /@smoke/,
      use: { ...devices["Desktop Safari"], viewport: { width: 1440, height: 900 } },
    },
  ],
});
