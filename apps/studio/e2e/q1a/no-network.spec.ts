/**
 * Studio makes no outside request of its own (spec L13: no backend, no analytics; L882: no error reporting unless
 * the person opts in). A first visit (Flow 1), a recipe loaded from its card and an export, with no chain chosen,
 * reach nothing but Studio's own origin: the kit's network guard (`blockedRequests`) stops and lists every request
 * to another host, so the list must stay empty. Chain reads, Sourcify and WalletConnect only start once a person
 * picks a chain or a wallet, which this run never does.
 */
import { expect, test } from "../_support/fixtures.ts";
import { region } from "../_support/keys.ts";
import { openEmpty } from "../_support/seed.ts";
import { SheetPage } from "./pages/sheet-page.ts";

test.describe("No outside requests (spec L13, L882)", () => {
  test("a first visit, a recipe from its card and an export stay on Studio's origin", async ({ page, blockedRequests }) => {
    await openEmpty(page);
    const sheet = new SheetPage(page);
    await expect(sheet.startTitle).toBeVisible();

    await sheet.recipeCard("ERC20").click();
    await expect(sheet.card("ERC20")).toBeVisible();

    const console_ = region(page, "Console");
    await console_.getByRole("button", { name: "Export", exact: true }).click();
    const menu = page.getByRole("menu", { name: "Export" });
    await expect(menu).toBeVisible();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      menu.getByRole("menuitem", { name: "Agent brief", exact: true }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/\.brief\.md$/);

    // Anything the page starts late (a lazy chunk, a chain read on a timer) has had its chance by now.
    await page.waitForLoadState("networkidle");
    expect(blockedRequests, `outside requests:\n${blockedRequests.join("\n")}`).toEqual([]);
  });
});
