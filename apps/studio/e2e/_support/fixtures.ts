/**
 * The `test` every end-to-end suite imports (instead of `@playwright/test`'s):
 *
 *   import { expect, test } from "../_support/fixtures.ts";
 *
 *   test("deploys GovernedVault @smoke", async ({ page, anvil }) => { … });
 *
 * Fixtures:
 * - `blockedRequests` (automatic): every request to a host other than the loopback is aborted and listed here.
 * - `anvil`: this worker's Anvil node (chain 31337 on `ANVIL_PORT_BASE + parallelIndex`), prepared once per worker
 *   with CreateX, Multicall3, the stand-in Safe and every v1 recipe's shared contracts, and wired to the page
 *   (`settings.rpc[31337]`). The chain goes back to its prepared state after each test. Asking for it is what
 *   starts a node: suites that never use it never start Anvil.
 */
import { test as base } from "@playwright/test";
import { prepareAnvil, startAnvil, type AnvilNode } from "./anvil.ts";
import { anvilPort } from "./env.ts";
import { keepLocal } from "./network.ts";
import { seedAnvilRpc } from "./wallet.ts";

export { expect } from "@playwright/test";

type TestFixtures = {
  /** Non-local requests the page tried, in order; each was aborted. */
  blockedRequests: string[];
  /** This worker's Anvil node, wired to the page and reverted after the test. */
  anvil: AnvilNode;
};

type WorkerFixtures = {
  /** This worker's prepared Anvil node. Use `anvil` in tests; this one isn't reverted. */
  anvilNode: AnvilNode;
};

export const test = base.extend<TestFixtures, WorkerFixtures>({
  // The PWA's service worker answers from its cache, where `page.route` (the network guard, seeding's catalog
  // hold, a suite's stubs) can't see the request. Suites about offline and updates opt back in with
  // `test.use({ serviceWorkers: "allow" })`.
  serviceWorkers: "block",

  blockedRequests: [
    async ({ context }, provide) => {
      await provide(await keepLocal(context));
    },
    { auto: true },
  ],

  anvilNode: [
    // Playwright reads fixture dependencies from the first parameter's destructuring pattern; this one has none.
    // oxlint-disable-next-line no-empty-pattern
    async ({}, provide, workerInfo) => {
      const node = await startAnvil(anvilPort(workerInfo.parallelIndex));
      try {
        await prepareAnvil(node);
        await provide(node);
      } finally {
        await node.stop();
      }
    },
    { scope: "worker", timeout: 180_000 },
  ],

  anvil: async ({ anvilNode, context }, provide) => {
    await seedAnvilRpc(context, anvilNode);
    const snapshot = await anvilNode.snapshot();
    await provide(anvilNode);
    await anvilNode.revert(snapshot);
  },
});
