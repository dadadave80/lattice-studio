/**
 * Board: `design/boards/current-empty-sheet.png` ("Empty sheet", row 11). No facets placed, both themes: the
 * 8 px dot grid (spec L357) behind the Start block (spec L378, IR L108, Flows 1-2).
 *
 * Difference from the board (not a spec decision beyond PA L64-65's Start block ruling): the board's copy is a
 * terse "PLACE A MODULE. ROUTE ITS SELECTORS." / "PATCH A MODULE. ROUTE ITS JACKS." headline over the grid, with
 * no cards. PA L65 says v1's Start block ships GovernedVault, ERC20 and SafeDiamondCut cards instead, and that
 * is what `StartBlock` (`sheet/chrome/StartBlock.tsx`) actually renders: "Start a diamond", Blank diamond, the
 * three recipe cards, Browse all recipes, the hint ("Drag from the catalog, or press ⌘K") and the tour line.
 * The terse headline copy itself was never built; this baseline shoots the real DOM. the dark theme's rack rails
 * (PA L63: "optional") aren't implemented either — grep finds no rack/rail styling — so the dark screenshot
 * shows the same ground as light, just themed.
 */
import { beforeAll, describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { emptyProject, renderSheet } from "@/sheet/canvas/testing/sheet-harness";
import { BLANK_DIAMOND_LABEL } from "@/sheet/chrome/copy";

function sheetElement(): HTMLElement {
  const el = document.querySelector<HTMLElement>('[data-region="sheet"]');
  if (!el) throw new Error("No sheet.");
  return el;
}

beforeAll(async () => {
  await Promise.all(
    ['400 13px "JetBrains Mono"', '600 13px "JetBrains Mono"', '400 14px Inter', '600 14px Inter', '600 12px Inter'].map(
      (font) => document.fonts.load(font),
    ),
  );
});

describe.each(["dark", "light"] as const)("board: empty sheet (%s)", (theme) => {
  test("the dot grid behind Start a diamond: Blank diamond, v1's three recipes, the hint and the tour line", async () => {
    await renderSheet({ project: emptyProject("empty"), theme, settings: { reduceMotion: "on" } });
    const start = page.getByRole("region", { name: "Start a diamond" });
    await expect.element(start).toBeVisible();
    await expect.element(start.getByRole("button", { name: BLANK_DIAMOND_LABEL })).toBeVisible();
    for (const name of ["GovernedVault", "ERC20", "SafeDiamondCut"]) {
      await expect.element(start.getByRole("button", { name: new RegExp(`^${name} `) })).toBeVisible();
    }
    await expect.element(start.getByText(/^Drag from the catalog, or press (⌘K|Ctrl\+K)$/)).toBeVisible();
    await expect.element(start.getByText(/^New here\?/)).toBeVisible();
    expect(document.querySelector(".react-flow__background")).not.toBeNull();
    // The Start block centers on the sheet's measured height (React Flow's fitView), which can still move a
    // frame or two after the shell's first layout pass; wait until its position holds still before shooting.
    const top = () => start.element().getBoundingClientRect().top;
    await expect
      .poll(() => {
        const at = top();
        return new Promise<boolean>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve(top() === at)))),
        );
      })
      .toBe(true);
    await document.fonts.ready;
    await expect.element(page.elementLocator(sheetElement())).toMatchScreenshot(`empty-sheet-start-${theme}`);
  });
});
