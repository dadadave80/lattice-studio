/**
 * Deploy review states (spec L561-L573, Flow 12), keyboard only: a filled GovernedVault on this test's Anvil node,
 * the mock wallet connected there, the review opened with ⌘/Ctrl+Enter and its acknowledgements ticked. A failed
 * deploy comes from the transaction being refused: `eth_sendTransaction` is answered with a JSON-RPC error, and
 * everything else goes through.
 */
import { expect, type BrowserContext, type Locator, type Page, type Route } from "@playwright/test";
import { focusRegion } from "../../_support/keys.ts";
import { recipeProject } from "../../_support/projects.ts";
import { seedProject } from "../../_support/seed.ts";
import { MOCK_ACCOUNT, shortAddress } from "../../_support/wallet.ts";
import { pressMod, runConsole, runInPalette, tabTo, waitForSheet } from "./keyboard.ts";

/**
 * Keeps the page online whatever the machine's own connection does. Studio reads `navigator.onLine` and the
 * window's `offline` event (src/pwa/connection.ts) and blocks Deploy while offline ("Deploy needs a connection"),
 * even for a local Anvil node; Chromium reports the host's network, so a dropped Wi-Fi link during a run failed
 * these specs although every request they make stays on the loopback. Call before the first `page.goto`.
 */
export async function stayOnline(context: BrowserContext): Promise<void> {
  await context.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, "onLine", { configurable: true, get: () => true });
    window.addEventListener("offline", (event) => event.stopImmediatePropagation(), true);
  });
}

/** The review dialog: "Deploy {project}". */
export function deployReview(page: Page): Locator {
  return page.getByRole("dialog", { name: /^Deploy / });
}

/** Seeds a filled GovernedVault, selects Anvil and connects the mock wallet there, keyboard only. */
export async function readyToDeploy(page: Page): Promise<void> {
  await seedProject(page, { project: recipeProject("GovernedVault", { filled: true }) });
  await waitForSheet(page);
  const log = page.getByRole("log");
  await runConsole(page, "chain anvil");
  await runInPalette(page, "Connect wallet");
  await expect(log.getByText(`Connected ${shortAddress(MOCK_ACCOUNT)}`, { exact: false })).toBeVisible();
  await runInPalette(page, "Switch network");
  await expect(log.getByText("Switched your wallet to Anvil.", { exact: false })).toBeVisible();
}

/** ⌘/Ctrl+Enter from the title bar, waiting until the review has simulated. */
export async function openDeployReview(page: Page): Promise<Locator> {
  await focusRegion(page, "Title bar");
  await pressMod(page, "Enter");
  const review = deployReview(page);
  await expect(review).toBeVisible({ timeout: 20_000 });
  await expect(review.getByRole("region", { name: "Simulation" })).toContainText("Simulated at block", { timeout: 30_000 });
  return review;
}

/** Tabs to every unticked acknowledgement in the review's Checks and ticks it with Space. */
export async function tickAcknowledgements(page: Page, review: Locator): Promise<void> {
  const checks = review.getByRole("region", { name: "Checks" }).getByRole("checkbox");
  const count = await checks.count();
  for (let i = 0; i < count; i += 1) {
    const box = checks.nth(i);
    if (await box.isChecked()) continue;
    await tabTo(page, box);
    await page.keyboard.press("Space");
    await expect(box).toBeChecked();
  }
  // A tick changes the review, so it simulates again before Sign & deploy opens.
  await expect(review.getByRole("button", { name: "Sign & deploy" })).toBeEnabled({ timeout: 30_000 });
  await expect(review.getByRole("region", { name: "Simulation" })).toContainText("Simulated at block");
}

/**
 * The console line a refused send leaves: a Deploy (or Error) line that isn't the review's or the simulation's. viem
 * words it ("Transaction creation failed."), not the spec, so the suite matches the line's kind, not its text.
 */
export const DEPLOY_FAILURE_LINE = /^(Deploy|Error) (?!Review:|Simulated at block)/;

/** A node's refusal, as JSON-RPC answers it. */
export const REFUSAL = "insufficient funds for gas * price + value";

function isLocal(url: string): boolean {
  return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname);
}

/**
 * Refuses every `eth_sendTransaction` the page sends, as a node would (`REFUSAL`); every other request goes on. It
 * watches every URL, not only the node's: wagmi's mock connector sends the transaction to the RPC of the chain it
 * started on (Sepolia's), whatever the switch said, so the network guard would abort it before a node could answer.
 * Nothing leaves the machine either way: the refusal is answered here.
 */
export async function refuseTransactions(page: Page): Promise<void> {
  await page.route("**/*", async (route: Route) => {
    const request = route.request();
    if (request.method() !== "POST") return route.fallback();
    let body: unknown;
    try {
      body = request.postDataJSON() as unknown;
    } catch {
      return route.fallback();
    }
    const calls = (Array.isArray(body) ? body : [body]) as { id?: number; method?: string }[];
    if (!calls.some((call) => call?.method === "eth_sendTransaction")) return route.fallback();
    const upstream = calls.filter((call) => call.method !== "eth_sendTransaction");
    const answered = new Map<number | undefined, unknown>();
    if (upstream.length > 0 && isLocal(request.url())) {
      const response = await route.fetch({ postData: JSON.stringify(Array.isArray(body) ? upstream : upstream[0]) });
      const json = (await response.json()) as unknown;
      for (const one of (Array.isArray(json) ? json : [json]) as { id?: number }[]) answered.set(one.id, one);
    }
    const replies = calls.map(
      (call) => answered.get(call.id) ?? { jsonrpc: "2.0", id: call.id, error: { code: -32003, message: REFUSAL } },
    );
    // The RPC is another origin than the page, so the answer carries the CORS header a node sends.
    await route.fulfill({
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify(Array.isArray(body) ? replies : replies[0]),
    });
  });
}

/**
 * Signs from the review with the keyboard (Tab to Sign & deploy, Enter) and waits for the refusal: the console's
 * failure line, with the review still open.
 */
export async function failDeploy(page: Page, review: Locator): Promise<void> {
  await tabTo(page, review.getByRole("button", { name: "Sign & deploy" }));
  await page.keyboard.press("Enter");
  await expect(page.getByRole("log").getByRole("button", { name: DEPLOY_FAILURE_LINE }).last()).toBeVisible({ timeout: 30_000 });
  await expect(deployReview(page)).toBeVisible();
}
