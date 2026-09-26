/**
 * Where the performance benchmarks (brief Q4) serve, write and how long they run. `bun scripts/perf/run.ts` sets
 * `PERF_OUT` and `PERF_SMOKE`; run on their own (`bun x playwright test -c test/perf/playwright.perf.config.ts` in
 * apps/studio) they write to the same default folder. Ports come from `local-env.ts`, never a fixed one.
 *
 * Playwright runs this under Node: nothing here may use Bun's APIs.
 */
import { join } from "node:path";
import { appDir, localEnv, localPort } from "../../local-env.ts";

/** The production build `vite preview` serves: the build of record `bun scripts/ci/size.ts --build` wrote. */
export const DIST_DIR = join(appDir, "dist");

/** The port `vite preview` listens on: this worktree's `STUDIO_PORT`. */
export function previewPort(): number {
  return localPort("STUDIO_PORT");
}

/** The folder this run's JSON results go to (gitignored under test-results/). */
export function perfOut(): string {
  return localEnv("PERF_OUT") ?? join(appDir, "test-results", `perf-${previewPort()}`);
}

/** `--smoke`: one short pass of each benchmark, checking the harness works; budgets aren't enforced. */
export function smoke(): boolean {
  return localEnv("PERF_SMOKE") === "1";
}

/** CPU slowdown for every benchmark (spec L803: a 4×-throttled headless Chromium). */
export const CPU_THROTTLE = 4;
