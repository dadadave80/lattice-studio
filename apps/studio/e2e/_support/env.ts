/**
 * Ports and paths for the end-to-end kit (contracts §2, "Ports and environment"). Values come from `process.env`,
 * then the repo root's `.env.local` (through `local-env.ts`), then the defaults. Nothing here binds a fixed port.
 *
 * Playwright runs under Node, so nothing in `_support/` may use Bun's APIs.
 */
import { join } from "node:path";
import { localPort, repoRoot } from "../../local-env.ts";

export { repoRoot };

/** The loopback host every local server of the kit listens on. The e2e preview's CSP allows it (`preview-csp.ts`). */
export const LOOPBACK = "127.0.0.1";

/**
 * A worktree's slot is 20 ports: the app's three, then `ANVIL_PORT_BASE` and the 16 after it (contracts §2). Q5's
 * chain tests use the same range, but they never run in the same process as Playwright.
 */
export const ANVIL_PORTS_PER_SLOT = 17;

/**
 * The Anvil port for one Playwright worker: `ANVIL_PORT_BASE + parallelIndex`. `parallelIndex` (not
 * `workerIndex`) stays below the worker count when a worker restarts, so the port stays inside the slot.
 */
export function anvilPort(parallelIndex: number): number {
  if (!Number.isInteger(parallelIndex) || parallelIndex < 0 || parallelIndex >= ANVIL_PORTS_PER_SLOT) {
    throw new RangeError(
      `Worker ${parallelIndex} has no Anvil port: a slot holds ${ANVIL_PORTS_PER_SLOT}. Run with --workers=${ANVIL_PORTS_PER_SLOT} or fewer.`,
    );
  }
  return localPort("ANVIL_PORT_BASE") + parallelIndex;
}

/** An Anvil node's URL on the loopback host. */
export function anvilUrl(port: number): string {
  return `http://${LOOPBACK}:${port}`;
}

/** Q5's vendored runtime code (read-only here): CreateX and Multicall3, checked against core's codehashes. */
export const VENDOR_DIR = join(repoRoot, "e2e-chain", "vendor");
