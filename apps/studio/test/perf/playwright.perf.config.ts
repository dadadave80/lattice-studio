/**
 * Playwright for the performance benchmarks (brief Q4), apart from the end-to-end config: one worker, so no two
 * benchmarks share the CPU, Chromium only, against the production build in `dist/` served by `vite preview` on
 * this worktree's `STUDIO_PORT`. `bun scripts/perf/run.ts` starts that server itself (Lighthouse needs it too);
 * run on its own, the `webServer` below starts it.
 */
import { defineConfig, devices } from "@playwright/test";
import { appDir } from "../../local-env.ts";
import { perfOut, previewPort } from "./env.ts";

const port = previewPort();

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.perf.ts",
  outputDir: `${perfOut()}/playwright`,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  // A cold build (composition) and a throttled page load each take a while.
  timeout: 300_000,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${port}`,
    // The full Chromium in new headless mode: the same browser Lighthouse drives, with real frame presentation.
    channel: "chromium",
    serviceWorkers: "block",
    trace: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], channel: "chromium", viewport: { width: 1440, height: 900 } } }],
  webServer: {
    // Vite itself, not through `bun run`, so stopping the server stops the process that holds the port.
    command: "../../node_modules/.bin/vite preview --host localhost",
    cwd: appDir,
    url: `http://localhost:${port}/`,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
