/**
 * Former board: `design/boards/former-empty-sheet.png` (row 06: pinned strip, presets, tool strip with M/N).
 * Provisional (PA L84, "to design next" #11): v1's Start block ships GovernedVault, ERC20 and SafeDiamondCut
 * (not the board's Account/Account6900 presets, R20), so this is a placeholder for David's design pass, not the
 * board redrawn. `sheet/chrome/StartBlock.tsx`, registered onto the sheet by `sheet/chrome/services.ts`.
 *
 * Dropped, not built (PA L70, not tested here): the pinned infrastructure strip, area frames and selectable
 * dependencies (Blank diamond covers the core instead); the M (Move to…) and N (Comment) tools (M becomes
 * Move to…, N is gone). This file screenshots only the Start block region, both themes; the dot grid behind it
 * and the empty title block are `empty-sheet.browser.test.tsx`'s board (current-empty-sheet), not repeated here.
 */
import { beforeAll, describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { RECIPE_BLURBS, START_RECIPES } from "@/sheet/chrome/copy";
import { emptyProject, renderSheet, settled } from "@/sheet/canvas/testing/sheet-harness";

function startBlock(): HTMLElement {
  return page.getByRole("region", { name: "Start a diamond" }).element() as HTMLElement;
}

/** Two animation frames plus a short delay, so a screenshot lands on a fully composited frame rather than one
 * Chromium is still mid-paint on (~1% pixel flakiness with nothing wrong in the DOM; see provisional-minimap). */
async function settleFrame(): Promise<void> {
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  await new Promise((resolve) => setTimeout(resolve, 100));
}

beforeAll(async () => {
  await Promise.all(
    ['400 13px "JetBrains Mono"', '600 13px "JetBrains Mono"', '400 14px Inter', '600 14px Inter', '600 12px Inter'].map(
      (font) => document.fonts.load(font),
    ),
  );
});

// Warms the sheet's lazy chunk before any timed test pays for it (see provisional-init-order-mode's note).
test("(warm-up) loads the sheet's lazy chunk", async () => {
  const warm = await renderSheet({ project: emptyProject("warm") });
  await settled();
  await warm.unmount();
});

describe.each(["dark", "light"] as const)("provisional: the Start block, v1's three presets (%s)", (theme) => {
  test("Blank diamond, GovernedVault, ERC20 and SafeDiamondCut (not Account or Account6900, PA L65/L84)", async () => {
    await renderSheet({ project: emptyProject("empty"), theme, settings: { reduceMotion: "on" } });
    const start = page.getByRole("region", { name: "Start a diamond" });
    await expect.element(start).toBeVisible();
    expect(START_RECIPES).toEqual(["GovernedVault", "ERC20", "SafeDiamondCut"]);
    for (const name of START_RECIPES) {
      const card = start.getByRole("button", { name: new RegExp(`^${name} `) });
      await expect.element(card).toBeVisible();
      await expect.element(card.getByText(RECIPE_BLURBS[name] ?? "")).toBeVisible();
    }
    await expect.element(start.getByRole("button", { name: /^Account /, exact: false })).not.toBeInTheDocument();
    await document.fonts.ready;
    await settleFrame();
    await expect.element(page.elementLocator(startBlock())).toMatchScreenshot(`provisional-start-block-${theme}`);
  });
});
