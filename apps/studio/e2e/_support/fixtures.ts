/**
 * The `test` every end-to-end suite imports (instead of `@playwright/test`'s):
 *
 *   import { expect, test } from "../_support/fixtures.ts";
 *
 *   test("deploys GovernedVault @smoke", async ({ page, anvil }) => { … });
 *
 * Fixtures:
 * - `blockedRequests` (automatic): every request and WebSocket to a host other than the loopback is aborted or
 *   closed and listed here.
 * - `anvil`: a fresh Anvil node for this test (chain 31337 on `ANVIL_PORT_BASE`, the one Anvil port this worktree's
 *   line owns), holding the prepared chain: CreateX, Multicall3, the stand-in Safe and every v1 recipe's shared
 *   contracts. It's wired to the page (`settings.rpc[31337]`) and stopped after the test. The port is the lock: tests
 *   that ask for `anvil` run one at a time across workers, the others waiting their turn. Suites that never ask for
 *   it never start Anvil.
 * - `serviceWorkers` is "block" (see below).
 */
import { test as base } from "@playwright/test";
import { acquireAnvil, loadPrepared, type AnvilNode } from "./anvil.ts";
import { anvilPort } from "./env.ts";
import { keepLocal } from "./network.ts";
import { seedAnvilRpc } from "./wallet.ts";

export { expect } from "@playwright/test";

type TestFixtures = {
  /** Non-local requests and WebSockets the page tried, in order; each was aborted or closed. */
  blockedRequests: string[];
  /** A fresh node on the prepared chain, wired to the page and stopped after the test. */
  anvil: AnvilNode;
};

export const test = base.extend<TestFixtures>({
  // The PWA's service worker answers from its cache, where `page.route` (the network guard, seeding's catalog
  // hold, a suite's stubs) can't see the request. A suite about offline and updates can opt back in with
  // `test.use({ serviceWorkers: "allow" })`, and that weakens the guard: requests the worker makes itself, and
  // responses it serves from its cache, bypass `blockedRequests`. Such a suite asserts on the network itself.
  serviceWorkers: "block",

  blockedRequests: [
    async ({ context }, provide) => {
      await provide(await keepLocal(context));
    },
    { auto: true },
  ],

  anvil: [
    async ({ context }, provide) => {
      const node = await acquireAnvil(anvilPort());
      try {
        await loadPrepared(node);
        await seedAnvilRpc(context, node);
        await provide(node);
      } finally {
        await node.stop();
      }
    },
    // Waiting for another worker's Anvil test, then preparing the run's chain once, can outlast a test's budget.
    { timeout: 180_000 },
  ],
});
