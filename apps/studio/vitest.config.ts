/**
 * Vitest Browser Mode for component tests (contracts §1: K2, then frozen). Chromium through Playwright,
 * on this worktree's `VITEST_BROWSER_PORT`, with the app's own Vite config (React Compiler, CSS Modules,
 * `@/`, `/catalog/`). Output folders carry the port, because an implementer and its helpers share one
 * worktree. Screenshot baselines (`toMatchScreenshot`) stay in `__screenshots__` beside each test.
 */
import { playwright } from "@vitest/browser-playwright";
import { mergeConfig, type UserConfig } from "vite";
import { defineConfig } from "vitest/config";
import { join } from "node:path";
import { appDir, localPort } from "./local-env.ts";
import viteConfig from "./vite.config.ts";

export default defineConfig(async (env) => {
  const base: UserConfig = typeof viteConfig === "function" ? await viteConfig(env) : await viteConfig;
  const port = localPort("VITEST_BROWSER_PORT");
  const out = `test-results/${port}`;

  return mergeConfig(base, {
    server: { port, strictPort: true },
    // One dependency cache per Vitest port: an implementer and its helpers run Vitest in one worktree at once,
    // and a shared cache raced when it was clean or invalidated ("Vitest failed to find the runner"). It stays
    // under node_modules/, so @rolldown/plugin-babel's default exclude keeps the React Compiler off pre-bundled deps.
    cacheDir: join(appDir, "node_modules", `.vite-vitest-${port}`),
    // Pre-bundling the shared libraries up front only saves a reload when a test first imports one; the
    // per-port cache above is what keeps concurrent runs apart.
    optimizeDeps: {
      include: [
        "react", "react/jsx-dev-runtime", "react-dom/client", "zustand", "zustand/vanilla",
        "vitest-browser-react", "@base-ui/react/csp-provider", "@xyflow/react", "viem", "zod", "fflate", "fast-check",
      ],
    },
    test: {
      include: ["src/**/*.browser.test.{ts,tsx}", "test/**/*.browser.test.{ts,tsx}"],
      setupFiles: ["./test/harness/setup.ts"],
      api: { port, strictPort: true },
      attachmentsDir: `${out}/attachments`,
      browser: {
        enabled: true,
        headless: true,
        provider: playwright(),
        instances: [{ browser: "chromium" }],
        // The desktop reference (spec L349); tests that need a narrower window set their own.
        viewport: { width: 1440, height: 900 },
        screenshotDirectory: `${out}/screenshots`,
        screenshotFailures: true,
      },
    },
  });
});
