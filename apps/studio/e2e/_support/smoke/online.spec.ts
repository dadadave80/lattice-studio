/**
 * `stayOnline` (the `anvil` fixture applies it): the page ignores the host's connection, and still follows the
 * test's own `context.setOffline`. A host drop is played through CDP's network emulation, which is what Chromium
 * does when the machine's Wi-Fi goes: `navigator.onLine` turns false and a trusted `offline` event fires.
 */
import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "../fixtures.ts";
import { region } from "../keys.ts";
import { stayOnline } from "../network.ts";
import { openEmpty } from "../seed.ts";

const OFFLINE_LINE = "Offline. Composing works; deploy needs a connection.";

/** Opens the app and waits until it has loaded everything it loads on its own, so the drop only meets a settled page. */
async function openSettled(page: Page): Promise<void> {
  await openEmpty(page);
  await expect(region(page, "Sheet").getByRole("toolbar", { name: "Sheet tools" })).toBeVisible();
  await page.waitForLoadState("networkidle");
}

/** Drops the network the way a lost Wi-Fi link does; the returned function brings it back. */
async function dropHostNetwork(context: BrowserContext, page: Page): Promise<() => Promise<void>> {
  const cdp = await context.newCDPSession(page);
  const conditions = (offline: boolean) => ({ offline, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  await cdp.send("Network.emulateNetworkConditions", conditions(true));
  return async () => {
    await cdp.send("Network.emulateNetworkConditions", conditions(false));
    await cdp.detach();
  };
}

test.describe("stayOnline", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "The host drop is played through Chromium's CDP.");

  test("without it, a host drop takes Studio offline", async ({ page, context }) => {
    await openSettled(page);
    const restore = await dropHostNetwork(context, page);
    await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
    await expect(page.getByText(OFFLINE_LINE).first()).toBeVisible();
    await restore();
  });

  test("with it, a host drop changes nothing, and the test's own setOffline still does", async ({ page, context }) => {
    await stayOnline(context);
    await openSettled(page);
    const restore = await dropHostNetwork(context, page);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => navigator.onLine)).toBe(true);
    await expect(page.getByText(OFFLINE_LINE)).toHaveCount(0);
    await restore();

    await context.setOffline(true);
    expect(await page.evaluate(() => navigator.onLine)).toBe(false);
    await expect(page.getByText(OFFLINE_LINE).first()).toBeVisible();
    await context.setOffline(false);
    expect(await page.evaluate(() => navigator.onLine)).toBe(true);
    await expect(page.getByText(OFFLINE_LINE)).toHaveCount(0);
    // A page loaded after that starts online too.
    await page.reload();
    await expect(page).toHaveTitle(/^Untitled /);
    expect(await page.evaluate(() => navigator.onLine)).toBe(true);
  });
});
