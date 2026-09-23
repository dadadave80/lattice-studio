/**
 * Ports and paths for the end-to-end kit (contracts §2, "Ports and environment"). Values come from `process.env`,
 * then the repo root's `.env.local` (through `local-env.ts`), then the defaults. Nothing here binds a fixed port.
 *
 * Playwright runs under Node, so nothing in `_support/` may use Bun's APIs.
 */
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localPort, repoRoot } from "../../local-env.ts";

export { repoRoot };

/** The loopback host every local server of the kit listens on. The e2e build's CSP allows it (`build/headers.ts`). */
export const LOOPBACK = "127.0.0.1";

/**
 * The one Anvil port the kit uses: `ANVIL_PORT_BASE`, the only Anvil port this worktree's line owns (claim.ts gives
 * a WP and each of its helpers a line of four; the ports after it belong to the next helper's line, then to the next
 * worktree's slot). Workers never take another port: they share this one, one test at a time (`fixtures.ts`), so
 * Anvil tests run one after another whatever `--workers` says, and never spill into a neighbor's ports.
 */
export function anvilPort(): number {
  return localPort("ANVIL_PORT_BASE");
}

/** An Anvil node's URL on the loopback host. */
export function anvilUrl(port: number): string {
  return `http://${LOOPBACK}:${port}`;
}

/**
 * Where the kit keeps per-line state outside the repo: the PIDs of the Anvil nodes it started (so global setup and
 * teardown can sweep orphans) and the prepared chain of the current run.
 */
export function kitDir(port: number = anvilPort()): string {
  return join(tmpdir(), "lattice-studio-e2e", String(port));
}

/** Q5's vendored runtime code (read-only here): CreateX and Multicall3, checked against core's codehashes. */
export const VENDOR_DIR = join(repoRoot, "e2e-chain", "vendor");
