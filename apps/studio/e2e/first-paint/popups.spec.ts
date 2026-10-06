/**
 * Menus and tooltips load in their own chunk after the first paint (Q19, `ui/popups/load.ts`). Until it arrives a
 * menu is its trigger alone; when it does, the triggers are re-created, and the one that had focus keeps it.
 */
import { expect, test } from "../_support/fixtures.ts";

test("the App menu's trigger is there before the popups chunk, and keeps focus when it arrives", async ({ page }) => {
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/\/assets\/popups-[^/]+\.js$/, async (route) => {
    await held;
    await route.continue();
  });
  await page.goto("/");

  const trigger = page.getByRole("button", { name: "Lattice Studio" });
  await expect(trigger).toBeVisible();
  // Nothing of Base UI's popups yet: no tooltip on any button.
  await expect(page.locator("[data-base-ui-tooltip-trigger]")).toHaveCount(0);
  await trigger.focus();

  release();
  await expect(page.locator("[data-base-ui-tooltip-trigger]").first()).toBeAttached();
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menu", { name: "App menu" })).toBeVisible();
});
