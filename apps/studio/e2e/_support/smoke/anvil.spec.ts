/**
 * The Anvil kit: CreateX, Multicall3 and the stand-in Safe are where core expects them, every v1 recipe's shared
 * contracts are deployed at their catalog addresses with the catalog's codehashes, the page reaches the node
 * through the seeded RPC, and each test starts from the prepared chain.
 */
import { CREATEX, CREATEX_CODEHASH, MULTICALL3, MULTICALL3_CODEHASH, loadTemplate } from "@lattice-studio/core";
import { encodeFunctionData, parseAbi, type Address } from "viem";
import { ANVIL_CHAIN_ID, BOB, SAFE } from "../anvil.ts";
import { catalog, neededFor, sharedContracts, v1Recipes } from "../catalog.ts";
import { expect, test } from "../fixtures.ts";
import { SETTINGS_KEY, openEmpty } from "../seed.ts";

const MARKER = 123_456_789n;

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
