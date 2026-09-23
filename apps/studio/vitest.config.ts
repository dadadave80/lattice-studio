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
    // Every dependency the app's own code imports is found and pre-bundled at startup (`entries`), so none is first
    // met mid-run: a mid-run optimize reloads the page and the run loses its runner. `include` is the backstop for
    // test-only libraries and subpaths the scan can't see.
    optimizeDeps: {
      entries: ["src/**/*.{ts,tsx}", "test/**/*.{ts,tsx}", "!src/**/*.test.{ts,tsx}"],
      include: [
        "react", "react/jsx-dev-runtime", "react-dom/client", "zustand", "zustand/vanilla",
        "vitest-browser-react", "@xyflow/react", "viem", "zod", "fflate", "fast-check", "idb", "workbox-window",
        ...["csp-provider", "button", "tooltip", "toggle", "toggle-group", "switch", "checkbox", "radio", "radio-group",
          "select", "input", "menu", "context-menu", "popover", "dialog", "toast", "tabs", "toolbar"]
          .map((part) => `@base-ui/react/${part}`),
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
