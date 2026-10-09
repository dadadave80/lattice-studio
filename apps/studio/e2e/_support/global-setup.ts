/**
 * Playwright's global setup (Q0): builds the app with `VITE_STUDIO_E2E=1` in `--mode e2e` (contracts §5.5) into
 * `dist-e2e-<PLAYWRIGHT_PORT>`, so two runs in one worktree (a WP and its helpers) never overwrite each other's
 * build, and serves it with `vite preview` on this worktree's `PLAYWRIGHT_PORT`. It also sweeps Anvil nodes an
 * earlier run left behind (a worker killed hard never stops its node) and names this run, so the prepared chain is
 * built once per run. The returned function stops the server and sweeps again.
 *
 * `STUDIO_E2E_REUSE_BUILD=1` skips the build when that folder already holds one: handy while writing a spec,
 * never set in the merge gates.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { build, preview } from "vite";
import { appDir, localEnv, localPort } from "../../local-env.ts";
import { RUN_ID_VARIABLE, clearPrepared, sweepAnvils } from "./anvil.ts";
import { anvilPort } from "./env.ts";

/** The build folder for a Playwright port. */
export function e2eOutDir(port: number): string {
  return join(appDir, `dist-e2e-${port}`);
}

function sweep(when: string): void {
  const anvil = anvilPort();
  const killed = sweepAnvils(anvil);
  if (killed.length > 0) console.log(`${when}: stopped ${killed.length} orphaned Anvil node(s) on port ${anvil} (${killed.join(", ")}).`);
  clearPrepared(anvil);
}

// Playwright loads global setup through its default export.
// oxlint-disable-next-line import/no-default-export
export default async function globalSetup(): Promise<() => Promise<void>> {
  const port = localPort("PLAYWRIGHT_PORT");
  const outDir = e2eOutDir(port);
  const configFile = join(appDir, "vite.config.ts");
  // Vite's loadEnv reads VITE_* from the process, and the config's guard allows the flag only in `--mode e2e`. The
  // preview's CSP reads it too: in the e2e build `connect-src` allows the loopback Anvil nodes (build/headers.ts).
  process.env.VITE_STUDIO_E2E = "1";
  // Workers inherit the runner's environment: every worker of this run shares one prepared chain.
  process.env[RUN_ID_VARIABLE] = `${process.pid}-${Date.now()}`;
  // Without anvil every start fails like a busy port (`isPortBusyReason`), so each Anvil test would wait out its
  // fixture's timeout: hours on CI. Say so once, up front.
  try {
    execFileSync("anvil", ["--version"], { stdio: "ignore" });
  } catch {
    throw new Error("anvil isn't on PATH. Install Foundry (foundryup) before running e2e.");
  }
  sweep("Before the run");

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
  });
  return async () => {
    await server.close();
    sweep("After the run");
  };
}
