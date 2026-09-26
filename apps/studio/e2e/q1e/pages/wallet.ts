/**
 * The mock wallet on Anvil, keyboard only.
 *
 * The e2e build's mock connector sends on the chain the wallet is on, straight to the test's own Anvil node (the
 * RPC the fixture seeds for chain 31337), and refuses to reach any other chain (FX25). No route is needed to get a
 * transaction to Anvil; a test proves a send from the node itself (its blocks, the account's nonce).
 */
import { expect, type Page, type Route } from "@playwright/test";
import { ANVIL_CHAIN_ID } from "../../_support/anvil.ts";
import { MOCK_ACCOUNT, shortAddress } from "../../_support/wallet.ts";
import { runConsoleLine, runPalette } from "./keys.ts";

type RpcCall = { method?: string; params?: unknown[] };

const ANVIL_HEX = `0x${ANVIL_CHAIN_ID.toString(16)}`;

/** Whether a JSON-RPC body is the mock connector's transaction for Anvil. */
export function isAnvilSend(body: string | null): boolean {
  if (!body) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return false;
  }
  const calls = (Array.isArray(parsed) ? parsed : [parsed]) as RpcCall[];
  return calls.length > 0 && calls.every((call) => {
    if (call.method !== "eth_sendTransaction") return false;
    const tx = call.params?.[0] as { chainId?: string } | undefined;
    return tx?.chainId?.toLowerCase() === ANVIL_HEX;
  });
}

/**
 * Makes the wallet answer every Anvil transaction with EIP-1193's 4001, as a person rejecting it in their wallet
 * would: a JSON-RPC `eth_sendTransaction` for chain 31337 and nothing else, so every read the app makes passes
 * through to the node.
 */
export async function rejectMockSends(page: Page): Promise<() => number> {
  let rejected = 0;
  await page.route(
    () => true,
    async (route: Route) => {
      const request = route.request();
      const body = request.postData();
      if (request.method() !== "POST" || !isAnvilSend(body)) {
        await route.fallback();
        return;
      }
      rejected += 1;
      const parsed = JSON.parse(body ?? "{}") as { id?: number } | { id?: number }[];
      const answer = (id: number | undefined) => ({ jsonrpc: "2.0", id: id ?? 1, error: { code: 4001, message: "User rejected the request." } });
      const json = Array.isArray(parsed) ? parsed.map((call) => answer(call.id)) : answer(parsed.id);
      await route.fulfill({ json, headers: { "access-control-allow-origin": "*" } });
    },
  );
  return () => rejected;
}

type SimulateResult = { gasUsed?: string; calls?: { gasUsed?: string }[] }[];

/**
 * Makes the node's `eth_simulateV1` answers report `gas` for every call, as a recipe too large for the chain's
 * per-transaction cap would. Anvil's cap is fixed in Studio's chain table (30M) and a v1 recipe needs about 7M, so
 * this stub is the only local way to reach NET-06 (spec L339). Everything else the node answers is untouched.
 */
export async function inflateSimulatedGas(page: Page, anvilUrl: string, gas: bigint): Promise<void> {
  const hex = `0x${gas.toString(16)}`;
  await page.route(
    (url) => url.href.startsWith(anvilUrl),
    async (route: Route) => {
      const body = route.request().postData() ?? "";
      if (!body.includes("eth_simulateV1")) {
        await route.fallback();
        return;
      }
      const response = await route.fetch();
      const payload = (await response.json()) as unknown;
      const answers = (Array.isArray(payload) ? payload : [payload]) as { result?: SimulateResult }[];
      for (const answer of answers) {
        if (!Array.isArray(answer.result)) continue;
        for (const block of answer.result) {
          if (block.gasUsed !== undefined) block.gasUsed = hex;
          for (const call of block.calls ?? []) call.gasUsed = hex;
        }
      }
      await route.fulfill({ response, json: payload });
    },
  );
}

/** Console `chain anvil`, then the palette's Connect wallet and Switch network, waiting for each result. */
export async function connectOnAnvil(page: Page): Promise<void> {
  const log = page.getByRole("log");
  await runConsoleLine(page, "chain anvil");
  await expect(log.getByText("Selected Anvil.", { exact: true })).toBeVisible();
  await runPalette(page, "Connect wallet");
  await expect(log.getByText(`Connected ${shortAddress(MOCK_ACCOUNT)} through Mock Connector.`, { exact: true })).toBeVisible();
  await runPalette(page, "Switch network");
  await expect(log.getByText("Switched your wallet to Anvil.", { exact: true })).toBeVisible();
}
