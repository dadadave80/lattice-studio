/**
 * The kit's `test` (`_support/fixtures.ts`) with one change: its `anvil` fixture waits its turn more patiently.
 *
 * The port is the kit's lock, and `acquireAnvil` retries while another worker's node holds it, but only when the
 * failure reads "address already in use". When two workers start at once, prool often reports the loser as
 * `Failed to start process "anvil": ` with no reason, and the kit's fixture fails the test instead of waiting (a
 * follow-up for Q0 from Q1e). This fixture treats that failure as a busy port too, then does what the kit's does.
 */
import { test as base } from "../../_support/fixtures.ts";
import { loadPrepared, startAnvil, type AnvilNode } from "../../_support/anvil.ts";
import { anvilPort } from "../../_support/env.ts";
import { seedAnvilRpc } from "../../_support/wallet.ts";

export { expect } from "../../_support/fixtures.ts";

function busy(error: unknown): boolean {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /PortBusyError|address already in use|Failed to start process "anvil"/i.test(text);
}

/** Starts a node on `port`, waiting (up to `waitMs`) while another worker's node holds it. */
export async function acquirePatiently(port: number, waitMs = 170_000): Promise<AnvilNode> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      return await startAnvil(port);
    } catch (error) {
      if (!busy(error) || Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
}

export const test = base.extend<{ anvil: AnvilNode }>({
  anvil: [
    async ({ context }, provide) => {
      const node = await acquirePatiently(anvilPort());
      try {
        await loadPrepared(node);
        await seedAnvilRpc(context, node);
        await provide(node);
      } finally {
        await node.stop();
      }
    },
    { scope: "test", timeout: 180_000 },
  ],
});
