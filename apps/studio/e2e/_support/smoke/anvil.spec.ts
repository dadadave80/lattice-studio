/**
 * The Anvil kit: CreateX, Multicall3 and the stand-in Safe are where core expects them, every v1 recipe's shared
 * contracts are deployed at their catalog addresses with the catalog's codehashes, the page reaches the node
 * through the seeded RPC, and each test starts from the prepared chain.
 */
import { CREATEX, CREATEX_CODEHASH, MULTICALL3, MULTICALL3_CODEHASH, loadTemplate } from "@lattice-studio/core";
import { encodeFunctionData, parseAbi, type Address } from "viem";
import {
  ANVIL_CHAIN_ID, BOB, PortBusyError, SAFE, acquireAnvil, isPortBusyReason, startAnvil, sweepAnvils, type AnvilNode,
} from "../anvil.ts";
import { anvilPort } from "../env.ts";
import { catalog, neededFor, sharedContracts, v1Recipes } from "../catalog.ts";
import { expect, test } from "../fixtures.ts";
import { SETTINGS_KEY, openEmpty } from "../seed.ts";

const MARKER = 123_456_789n;

test.describe("prool's busy-port detection @smoke", () => {
  test("treats a real EADDRINUSE as a busy port", () => {
    expect(isPortBusyReason("Error: listen EADDRINUSE: address already in use 127.0.0.1:8555")).toBe(true);
  });

  test("treats prool's reasonless anvil failure as a busy port too", () => {
    // Two workers racing the same port: the loser's anvil exits before prool captures why, so the message carries
    // no reason at all (Q1e's finding) or a truncated one (a live race on the port turned up a bare "Error", cut
    // off mid-write).
    expect(isPortBusyReason('Failed to start process "anvil": exited')).toBe(true);
    expect(isPortBusyReason('Failed to start process "anvil": ')).toBe(true);
    expect(isPortBusyReason('Failed to start process "anvil": \n\nError')).toBe(true);
    // A phrasing without the substring this file also checks for directly (Linux/Windows, a different Anvil build).
    expect(isPortBusyReason('Failed to start process "anvil": \n\nError: bind: address in use')).toBe(true);
  });

  test("doesn't swallow an error that has nothing to do with starting anvil", () => {
    expect(isPortBusyReason("TypeError: Cannot read properties of undefined")).toBe(false);
    expect(isPortBusyReason("some other error entirely")).toBe(false);
  });

  test("classifies a live two-way race on the port as busy, whichever shape prool reports it", async ({ anvil }) => {
    const port = anvil.port;
    await anvil.stop();
    let winner: AnvilNode | undefined;
    // A genuine race: two `startAnvil`s for the same port at once, no `acquireAnvil` retry. Exactly one binds; the
    // loser's rejection, in whatever shape prool gives it (Q1e found both "address already in use" and its own
    // reasonless one), must classify as `PortBusyError`. If neither of ours wins (another worker's fixture slipped
    // in between `stop()` and here), that's nobody's fault: try again.
    for (let attempt = 0; !winner && attempt < 5; attempt += 1) {
      const settled = await Promise.allSettled([startAnvil(port), startAnvil(port)]);
      const fulfilled = settled.filter((r): r is PromiseFulfilledResult<AnvilNode> => r.status === "fulfilled");
      const rejected = settled.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      const [win] = fulfilled;
      const [loss] = rejected;
      if (win && loss && fulfilled.length === 1 && rejected.length === 1) {
        const raw = loss.reason instanceof Error && loss.reason.cause instanceof Error ? loss.reason.cause : loss.reason;
        console.log(`prool's loser (attempt ${attempt}): ${raw instanceof Error ? `${raw.name}: ${raw.message}` : String(raw)}`);
        expect(loss.reason).toBeInstanceOf(PortBusyError);
        winner = win.value;
      } else {
        for (const r of fulfilled) await r.value.stop().catch(() => undefined);
      }
    }
    if (!winner) throw new Error("Couldn't force a two-way race on the port after 5 attempts.");
    await winner.stop();
  });
});

test.describe("Anvil kit @smoke", () => {
  test("etches CreateX, Multicall3 and a Safe that answers getThreshold()", async ({ anvil }) => {
    expect(await anvil.codehash(CREATEX)).toBe(CREATEX_CODEHASH);
    expect(await anvil.codehash(MULTICALL3)).toBe(MULTICALL3_CODEHASH);
    const data = encodeFunctionData({ abi: parseAbi(["function getThreshold() view returns (uint256)"]), functionName: "getThreshold" });
    const threshold = await anvil.client.call({ to: SAFE, data });
    expect(BigInt(threshold.data ?? "0x0")).toBe(2n);
  });

  for (const name of v1Recipes()) {
    test(`deploys ${name}'s shared contracts through Arachnid's proxy`, async ({ anvil }) => {
      const loaded = loadTemplate(catalog(), name);
      if (!loaded.ok) throw new Error(loaded.error);
      const needed = neededFor(loaded.value);
      const all = sharedContracts();
      expect(needed.length).toBeGreaterThan(2);
      for (const contract of needed) {
        const release = all.find((item) => item.name === contract)?.release;
        expect(release, `${contract} is a shared contract`).toBeDefined();
        expect(await anvil.codehash(release?.address as Address), `${contract} at ${release?.address}`).toBe(release?.codehash);
      }
    });
  }

  test("the page reaches this worker's node through settings.rpc[31337]", async ({ page, anvil }) => {
    await openEmpty(page);
    const rpc = await page.evaluate((key) => (JSON.parse(localStorage.getItem(key) ?? "{}") as { rpc?: Record<string, string> }).rpc?.["31337"], SETTINGS_KEY);
    expect(rpc).toBe(anvil.url);
    const chainId = await page.evaluate(async (url) => {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      });
      return ((await response.json()) as { result: string }).result;
    }, anvil.url);
    expect(Number(chainId)).toBe(ANVIL_CHAIN_ID);
  });

  test("uses only the line's own Anvil port, and sweeps a node a dead worker left", async ({ anvil }) => {
    expect(anvil.port).toBe(anvilPort());
    await anvil.stop();
    // A worker killed hard never stops its node: start one and "forget" it.
    const orphan = await acquireAnvil(anvilPort());
    expect(sweepAnvils(anvilPort()).length).toBe(1);
    // The port is free again: a new node binds at once.
    const next = await acquireAnvil(anvilPort(), 5_000);
    await next.stop();
    await orphan.stop().catch(() => undefined);
  });

  // Two tests in order: the first changes the chain, the second must not see it.
  test.describe.configure({ mode: "serial" });
  test("a test may change the chain", async ({ anvil }) => {
    await anvil.client.setBalance({ address: BOB, value: MARKER });
    expect(await anvil.client.getBalance({ address: BOB })).toBe(MARKER);
  });
  test("the next test starts from the prepared chain", async ({ anvil }) => {
    expect(await anvil.client.getBalance({ address: BOB })).not.toBe(MARKER);
  });
});
