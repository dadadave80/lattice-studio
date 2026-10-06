/**
 * The empty sheet's Start block draws and works before the canvas chunk arrives (Q19, `sheet/canvas/Sheet.tsx`).
 * When the canvas mounts its own block takes over, and the control a keyboard user had focused in the first one
 * keeps focus in the second, so the next Tab continues from there rather than from the page's top.
 */
import { expect, test } from "../_support/fixtures.ts";

test("the Start block's focused control keeps focus when the canvas takes over", async ({ page }) => {
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/\/assets\/SheetCanvas-[^/]+\.js$/, async (route) => {
    await held;
    await route.continue();
  });
  await page.goto("/");

  const block = page.locator("[data-chrome='start']");
  const blank = block.getByRole("button", { name: "Blank diamond" });
  await expect(blank).toBeVisible();
  await expect(page.locator(".react-flow")).toHaveCount(0);
  await blank.focus();

  release();
  await expect(page.locator(".react-flow [data-chrome='start']")).toBeVisible();
  await expect(page.locator(".react-flow").getByRole("button", { name: "Blank diamond" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.locator(".react-flow [data-chrome='start'] :focus")).toHaveCount(1);
});
