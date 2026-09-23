/**
 * wagmi's `mock` connector in the e2e build (contracts §5.5, S8a's `chain/infra/e2e.ts`): Anvil's account 0, which
 * Anvil signs for. The connector starts on the picker's first chain (Sepolia) and sends transactions to the RPC of
 * the chain it's on, so a test always points chain 31337 at its own node first (`seedAnvilRpc`), selects Anvil and
 * switches the wallet there before anything is sent. The network guard (`network.ts`) aborts anything that would
 * leave the machine anyway.
 *
 *   await seedAnvilRpc(context, anvil);        // before the first page.goto
 *   await page.goto("/");
 *   await connectMockWallet(page);            // chain anvil · Connect wallet · Switch network
 */
import { expect, type BrowserContext, type Page } from "@playwright/test";
import { ALICE, ANVIL_CHAIN_ID } from "./anvil.ts";
import { runConsole, runInPalette } from "./keys.ts";
import { seedSettings } from "./seed.ts";

/** The account the mock connector connects (Anvil's account 0). */
export const MOCK_ACCOUNT = ALICE;
/** wagmi's name for the connector, as the wallet list shows it. */
export const MOCK_CONNECTOR_NAME = "Mock Connector";

/** Points chain 31337 at `node` (Settings → Networks, `settings.rpc[31337]`) before the chain module loads. */
export async function seedAnvilRpc(context: BrowserContext, node: { url: string }): Promise<void> {
  await seedSettings(context, { rpc: { [ANVIL_CHAIN_ID]: node.url } });
}

/** "0xf39F…2266": how the console shortens an address (C10's `formatAddress`). */
export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * Selects Anvil (console `chain anvil`), connects the mock wallet (palette "Connect wallet") and switches it to
 * Anvil (palette "Switch network"), waiting for each console line. Keyboard only.
 */
export async function connectMockWallet(page: Page): Promise<void> {
  const log = page.getByRole("log");
  await runConsole(page, "chain anvil");
  await runInPalette(page, "Connect wallet");
  await expect(log.getByText(`Connected ${shortAddress(MOCK_ACCOUNT)}`, { exact: false })).toBeVisible();
  await runInPalette(page, "Switch network");
  await expect(log.getByText("Switched your wallet to Anvil.", { exact: false })).toBeVisible();
}
