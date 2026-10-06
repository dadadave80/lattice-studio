/**
 * The empty sheet's Start block draws and works before the canvas chunk arrives (Q19, `sheet/canvas/Sheet.tsx`).
 * When the canvas mounts its own block takes over, and the control a keyboard user had focused in the first one
 * keeps focus in the second, so the next Tab continues from there rather than from the page's top.
 */
import { expect, test } from "../_support/fixtures.ts";

// Blank diamond, a recipe card, Browse all recipes and the tour link.
for (const control of ["Blank diamond", "ERC20", "Browse all recipes", "Take the 60-second tour"]) {
  test(`the Start block's focused control keeps focus when the canvas takes over (${control})`, async ({ page }) => {
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(/\/assets\/SheetCanvas-[^/]+\.js$/, async (route) => {
      await held;
      await route.continue();
    });
    await page.goto("/");

    const before = page.locator("[data-chrome='start'] button", { hasText: control });
    await expect(before).toBeVisible();
    await expect(page.locator(".react-flow")).toHaveCount(0);
    await before.focus();
    await expect(before).toBeFocused();

    release();
    await expect(page.locator(".react-flow [data-chrome='start']")).toBeVisible();
    await expect(page.locator(".react-flow [data-chrome='start'] button", { hasText: control })).toBeFocused();
    // The next Tab (back from the tour link, the block's last control) stays in the block.
    await page.keyboard.press(control.startsWith("Take") ? "Shift+Tab" : "Tab");
    await expect(page.locator(".react-flow [data-chrome='start'] :focus")).toHaveCount(1);
  });
}
