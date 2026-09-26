/**
 * The mock wallet on Anvil, keyboard only.
 *
 * wagmi's `mock` connector answers `eth_sendTransaction` through the RPC of the first chain in the wagmi config
 * (its `getProvider()` is called without a chain id), and the e2e build lists Sepolia first. So a transaction meant
 * for Anvil (`chainId: 0x7a69`) leaves for Sepolia's public RPC, where the network guard aborts it and the app says
 * "HTTP request failed.". Until the build points the connector at the chain it's on (a CCR to S8a from Q1e), this
 * suite hands exactly those requests (JSON-RPC `eth_sendTransaction` for chain 31337) to the test's own Anvil node.
 * Every other non-local request still falls through to the guard, so nothing reaches a public network.
 */
import { expect, type Page, type Route } from "@playwright/test";
import { ANVIL_CHAIN_ID } from "../../_support/anvil.ts";
import { isLocalUrl } from "../../_support/network.ts";
import { MOCK_ACCOUNT, shortAddress } from "../../_support/wallet.ts";
import { runConsoleLine, runPalette } from "./keys.ts";

type RpcCall = { method?: string; params?: unknown[] };

const ANVIL_HEX = `0x${ANVIL_CHAIN_ID.toString(16)}`;

/** Whether a JSON-RPC body is a transaction for Anvil that the mock connector misrouted. */
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
 * Forwards the mock connector's Anvil transactions to `anvilUrl` (see the file comment). Returns the number of
 * transactions forwarded so far, so a test can assert the wallet really sent.
 */
export async function routeMockSends(page: Page, anvilUrl: string): Promise<() => number> {
  let forwarded = 0;
  await page.route(
    (url) => !isLocalUrl(url),
    async (route: Route) => {
      const request = route.request();
      if (request.method() !== "POST" || !isAnvilSend(request.postData())) {
        await route.fallback();
        return;
      }
      forwarded += 1;
      const response = await route.fetch({ url: anvilUrl });
      await route.fulfill({ response, headers: { ...response.headers(), "access-control-allow-origin": "*" } });
    },
  );
  return () => forwarded;
}

/**
 * Makes the wallet answer every Anvil transaction with EIP-1193's 4001, as a person rejecting it in their wallet
 * would. Same predicate as `routeMockSends` (a JSON-RPC `eth_sendTransaction` for chain 31337, nothing else), on
 * any host: today the mock connector misroutes the send to a public RPC, and once it sends to Anvil directly the
 * same route still catches exactly that request, while every read the app makes passes through. Register it after
 * `routeMockSends` (Playwright tries the newest route first).
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
