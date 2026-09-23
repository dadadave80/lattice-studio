/**
 * Playwright's global setup (Q0): builds the app with `VITE_STUDIO_E2E=1` in `--mode e2e` (contracts §5.5) into
 * `dist-e2e-<PLAYWRIGHT_PORT>`, so two runs in one worktree (a WP and its helpers) never overwrite each other's
 * build, and serves it with `vite preview` on this worktree's `PLAYWRIGHT_PORT`. The returned function stops the
 * server after the run.
 *
 * `STUDIO_E2E_REUSE_BUILD=1` skips the build when that folder already holds one: handy while writing a spec,
 * never set in the merge gates.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { build, preview } from "vite";
import { appDir, localEnv, localPort } from "../../local-env.ts";
import { e2eConnectSrc } from "./preview-csp.ts";

/** The build folder for a Playwright port. */
export function e2eOutDir(port: number): string {
  return join(appDir, `dist-e2e-${port}`);
}

// Playwright loads global setup through its default export.
// oxlint-disable-next-line import/no-default-export
export default async function globalSetup(): Promise<() => Promise<void>> {
  const port = localPort("PLAYWRIGHT_PORT");
  const outDir = e2eOutDir(port);
  const configFile = join(appDir, "vite.config.ts");
  // Vite's loadEnv reads VITE_* from the process, and the config's guard allows the flag only in `--mode e2e`.
  process.env.VITE_STUDIO_E2E = "1";

  const reuse = localEnv("STUDIO_E2E_REUSE_BUILD") === "1" && existsSync(join(outDir, "index.html"));
  if (!reuse) {
    await build({
      configFile,
      mode: "e2e",
      logLevel: "warn",
      build: { outDir, emptyOutDir: true },
    });
  }

  const server = await preview({
    configFile,
    mode: "e2e",
    logLevel: "warn",
    build: { outDir },
    preview: { port, strictPort: true, host: "localhost" },
    plugins: [e2eConnectSrc()],
  });
  return async () => {
    await server.close();
  };
}
