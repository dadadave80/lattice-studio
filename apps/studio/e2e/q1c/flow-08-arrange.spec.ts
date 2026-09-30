/**
 * Flow 8. Arrange (spec L471-L487): move by drag, Move to… (M), nudge, Tidy (T) and Tidy selection, Flip pins
 * (F), expand/collapse, zoom, pan, locate and Back to content. Layout lives outside the recipe hash, so nothing
 * here narrates a problem or changes what's live (spec L487).
 *
 * Copy quoted here, and where it comes from when the spec itself doesn't state it:
 * - "Tidied N facets." — `packages/core/src/narrate/lines.ts`'s `lines.tidied`.
 * - "Flipped pins on X.", "Expanded X.", "Collapsed X." — `packages/core/src/edit/project-ops.ts`'s
 *   `flipPins` and `setExpanded` summaries, narrated by `state/cmd/shared.ts`'s `edit()` (always logged, whatever
 *   ran the command: keys, menu or console — contracts §6, "every command says what it did").
 * - "Moved X[, position words].", the "Moved X" undo label — `apps/studio/src/sheet/interact/moves.ts`.
 * - "Moving X. Click the destination, or move with the arrows and press Enter. Esc cancels." —
 *   `apps/studio/src/sheet/interact/move-to.ts`'s `moveToWords`.
 * - "Undid: {label}.", "Redid: {label}." — `apps/studio/src/state/document-store.ts` (the same mechanism
 *   flow-09 quotes for placements; here it narrates every other kind of edit the same way).
 * - "+ n more" / "Collapse" / "Expand", "Tidy selection", "Move to…", "Flip pins" — `MoreButton.tsx`,
 *   `SheetMenu.tsx` (the card's context menu, IR L194).
 * - "Back to content" — `BackToContent.tsx`.
 *
 * Two things learned writing this file, beyond flow-09's environment workarounds (its header, and this file
 * only needs its `console-page.ts` helpers: every Flow 8 shortcut — M, T, F, V, H, arrows, ⇧0/⇧1/⇧2, +/− — is
 * bare or Shift-only, so the palette's own modifier chord never comes up):
 *
 * 1. A card's accessible name is never just its facet name: it's `card-model.ts`'s `cardName`, e.g.
 *    "ERC4626, 17 selectors, 5 served by other facets." Both `SheetPage.card()` and the Structure tree's rows
 *    use this, so every lookup here matches on `^Name, ` (a prefix), never `exact: true` on the bare name.
 * 2. `Locator.click()` on a card clicks the middle of its whole bounding box, which very often lands on a pin
 *    row instead of the header (a card is header + several selector rows). A pin row is its own real `<button>`
 *    inside `[data-keyctx="card-rows"]`: the click can silently run that pin's own action instead of selecting
 *    the card, and even where it also fires the card's `onNodeClick` (selecting it), real DOM focus lands in
 *    the row's context, not `sheet`'s — so a bare shortcut pressed right after silently does nothing (S4e's
 *    `key-context.ts` resolves the context from `document.activeElement`, not from the app's own selection
 *    state). This file never clicks a card's own bounding box; it selects and focuses through the keyboard
 *    (`sheet.focusFirst`/Home, real DOM focus) wherever a bare key follows, and otherwise clicks the header
 *    text (`getByText(name, { exact: true })`) when only mouse-driven selection (a menu command) is needed.
 */
import { isCoreFacet } from "@lattice-studio/core";
import { expect, test } from "../_support/fixtures.ts";
import { focusRegion } from "../_support/keys.ts";
import { collisionsProject, recipeProject } from "../_support/projects.ts";
import { openEmpty, seedProject } from "../_support/seed.ts";
import { NARROW_WIDTHS, tierAt, viewportAt } from "../_support/viewports.ts";
import { consoleLog, runConsoleCommand } from "./pages/console-page.ts";
import { SheetPage } from "./pages/sheet-page.ts";
import { TitleBarPage } from "./pages/title-bar-page.ts";

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A Structure tree row's accessible name is `card-model.ts`'s `cardName`, never the bare facet name. */
function treeitemName(facet: string): RegExp {
  return new RegExp(`^${escapeRegExp(facet)}, `);
}

/** A single placed card ("ERC20"): the lightest sheet for move/nudge/flip/zoom, seeded keyboard only. */
async function placeOne(page: import("@playwright/test").Page): Promise<string> {
  await openEmpty(page);
  await runConsoleCommand(page, "place erc20");
  return "ERC20";
}

/**
 * Two placed cards ("ERC20", "ERC4626") at their ad-hoc `place` positions (C9's `freeSlot`), which is never
 * what `tidy()` alone would produce for the pair — so a Tidy on this sheet always has something to do, unlike
 * a project this kit seeds with `projectFor` (which tidies once already, up front).
 */
async function placeTwo(page: import("@playwright/test").Page): Promise<[string, string]> {
  await openEmpty(page);
  await runConsoleCommand(page, "place erc20");
  await runConsoleCommand(page, "place erc4626");
  return ["ERC20", "ERC4626"];
}

/** Selects and really focuses `name`'s card from the keyboard: F6 to Sheet, then Home (the first card). */
async function focusOnlyCard(page: import("@playwright/test").Page, sheet: SheetPage, name: string): Promise<void> {
  await focusRegion(page, "Sheet");
  await page.keyboard.press("Home");
  await expect(async () => expect(await sheet.isSelected(name)).toBe(true)).toPass();
}

/**
 * F6 to Sheet, then Home selects the first card in reading order — which of `a`/`b` that is isn't specified, so
 * this checks both and returns which one moves (selected) and which stays put (the anchor for `expectOffset`).
 */
async function focusFirstOfTwo(
  page: import("@playwright/test").Page,
  sheet: SheetPage,
  a: string,
  b: string,
): Promise<{ moved: string; anchor: string }> {
  await focusRegion(page, "Sheet");
  await page.keyboard.press("Home");
  await expect(async () => {
    const selected = (await sheet.isSelected(a)) || (await sheet.isSelected(b));
    expect(selected).toBe(true);
  }).toPass();
  return (await sheet.isSelected(a)) ? { moved: a, anchor: b } : { moved: b, anchor: a };
}

/** `Undid: {label}.` / `Redid: {label}.`, the way every edit (not just a placement) is narrated. */
function undidLine(label: string): string {
  return `Undid: ${label}.`;
}
function redidLine(label: string): string {
  return `Redid: ${label}.`;
}

/**
 * `Shift+0` (Fit is `Shift+1`): 100%, so 1 sheet unit is 1 screen px while it holds. Move, Nudge and Move to…
 * never change zoom themselves (only Tidy does, "view fits", spec L476), so fixing it once up front, before
 * anything moves, is enough for the rest of a Move/Nudge test.
 */
async function zoomTo100(page: import("@playwright/test").Page, sheet: SheetPage): Promise<void> {
  await focusRegion(page, "Sheet");
  await page.keyboard.press("Shift+Digit0");
  await expect.poll(() => sheet.zoomText()).toBe("100%");
}

type Offset = { dx: number; dy: number };

/** `moved`'s box minus `anchor`'s, in screen px, or null if either card is off-screen. */
async function relativeOffset(sheet: SheetPage, moved: string, anchor: string): Promise<Offset | null> {
  const m = await sheet.cardBox(moved);
  const a = await sheet.cardBox(anchor);
  if (!m || !a) return null;
  return { dx: m.x - a.x, dy: m.y - a.y };
}

/**
 * `relativeOffset` once it stops changing: focusing a card scrolls it into view (a transition, not instant), so
 * a "before" value read right after triggering that would be mid-scroll, not the resting state a later
 * comparison needs. Polls until two reads 100 ms apart agree.
 */
async function stableOffset(page: import("@playwright/test").Page, sheet: SheetPage, moved: string, anchor: string): Promise<Offset> {
  let last = await relativeOffset(sheet, moved, anchor);
  for (let i = 0; i < 20; i += 1) {
    await page.waitForTimeout(100);
    const next = await relativeOffset(sheet, moved, anchor);
    if (last && next && Math.abs(last.dx - next.dx) < 0.5 && Math.abs(last.dy - next.dy) < 0.5) return next;
    last = next;
  }
  expect(last).not.toBeNull();
  return last as Offset;
}

/** A card's box once it stops changing (see `stableOffset`) — for Fit (⇧1), whose zoom and pan animate too. */
async function stableCardBox(page: import("@playwright/test").Page, sheet: SheetPage, name: string) {
  let last = await sheet.cardBox(name);
  for (let i = 0; i < 20; i += 1) {
    await page.waitForTimeout(100);
    const next = await sheet.cardBox(name);
    if (last && next && Math.abs(last.x - next.x) < 0.5 && Math.abs(last.y - next.y) < 0.5) return next;
    last = next;
  }
  expect(last).not.toBeNull();
  return last;
}

/**
 * Polls until `moved`'s box sits `dx, dy` screen px from `anchor`'s (at a fixed 100% zoom, see `zoomTo100`).
 * Every keyboard move (Move to…, Nudge) scrolls the affected card into view as it moves and again on undo
 * (spec L493, `move-to.ts`'s `finish`, `card-focus.ts`), which pans the whole sheet under both cards equally —
 * so a screen position read alone drifts with that pan, but the *offset between two cards* doesn't, since
 * panning moves them together. This is what actually proves a move happened without also asserting on pan,
 * which layout edits are free to change (pan and zoom are never undo steps, spec L492).
 */
async function expectOffset(sheet: SheetPage, moved: string, anchor: string, dx: number, dy: number): Promise<void> {
  await expect(async () => {
    const offset = await relativeOffset(sheet, moved, anchor);
    expect(offset).not.toBeNull();
    if (!offset) return;
    expect(offset.dx).toBeCloseTo(dx, 0);
    expect(offset.dy).toBeCloseTo(dy, 0);
  }).toPass({ timeout: 5000 });
}

/**
 * Right-clicks `name`'s card header (never the whole card's bounding box, which very often centers on a pin
 * row instead — see this file's header comment) and returns its context menu.
 */
async function openCardMenu(page: import("@playwright/test").Page, sheet: SheetPage, name: string) {
  await sheet.card(name).getByText(name, { exact: true }).click({ button: "right" });
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  return menu;
}

test.describe("Move by drag", () => {
  test("drags a card past the 4 px threshold, lands it 8 px-snapped, and one undo restores the exact spot @smoke", async ({
    page,
  }) => {
    // One card only: dragging is a single continuous pointer gesture with no keyboard "scroll it into view"
    // step in between (unlike Move to…, Nudge and Undo — see `expectOffset`'s doc comment), so its screen delta
    // is trustworthy on its own here. Two cards would risk the drop landing on the other one, which slides to
    // the nearest free slot instead of the raw offset (spec L473) — a second, unrelated reason to keep this to
    // one card.
    const name = await placeOne(page);
    const sheet = new SheetPage(page);
    const titleBar = new TitleBarPage(page);
    // 100% zoom: 1 screen px is 1 sheet unit, so the snap (8 px) is checkable straight off the bounding box.
    await focusOnlyCard(page, sheet, name);
    await zoomTo100(page, sheet);

    const before = await stableCardBox(page, sheet, name);
    expect(before).not.toBeNull();
    if (!before) return;
    // A multiple of 8 in both axes: cards are placed pre-snapped (C9's `freeSlot`/`tidy`), so the result stays
    // exactly `before + (136, 104)`, no rounding to reason about. Dragging an unselected card selects it, but
    // it's already selected here (spec L472, "grabbing a card that isn't selected selects it first").
    await sheet.dragCard(name, 136, 104, 10);

    await expect(page.getByRole("status")).toContainText(`Moved ${name}`);
    await expect(async () => {
      const box = await sheet.cardBox(name);
      expect(box).not.toBeNull();
      if (!box) return;
      expect(box.x).toBeCloseTo(before.x + 136, 0);
      expect(box.y).toBeCloseTo(before.y + 104, 0);
    }).toPass({ timeout: 5000 });

    await titleBar.undo();
    await expect(page.getByRole("status")).toContainText(undidLine(`Moved ${name}`));
    await expect(async () => {
      const box = await sheet.cardBox(name);
      expect(box).not.toBeNull();
      if (!box) return;
      expect(box.x).toBeCloseTo(before.x, 0);
      expect(box.y).toBeCloseTo(before.y, 0);
    }).toPass({ timeout: 5000 });
  });
});

test.describe("Move to…", () => {
  test("M, then the crosshair moved with the arrows, Enter drops it: one undo step", async ({ page }) => {
    const [a, b] = await placeTwo(page);
    const sheet = new SheetPage(page);
    const titleBar = new TitleBarPage(page);
    await zoomTo100(page, sheet);
    const { moved, anchor } = await focusFirstOfTwo(page, sheet, a, b);

    const before = await stableOffset(page, sheet, moved, anchor);
    await page.keyboard.press("m");
    await expect(page.getByRole("status")).toContainText(
      `Moving ${moved}. Click the destination, or move with the arrows and press Enter. Esc cancels.`,
    );
    // Nudge step (8 px) three times right, once down large (32 px): away from where it started.
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Shift+ArrowDown");
    await page.keyboard.press("Enter");

    await expect(page.getByRole("status")).toContainText(`Moved ${moved}`);
    await expectOffset(sheet, moved, anchor, before.dx + 24, before.dy + 32);

    await titleBar.undo();
    await expect(page.getByRole("status")).toContainText(undidLine(`Moved ${moved}`));
    await expectOffset(sheet, moved, anchor, before.dx, before.dy);
  });

  test("M, then a click drops the selection where the pointer is: the single-pointer alternative to dragging", async ({
    page,
  }) => {
    const [a, b] = await placeTwo(page);
    const sheet = new SheetPage(page);
    const titleBar = new TitleBarPage(page);
    await zoomTo100(page, sheet);
    const { moved, anchor } = await focusFirstOfTwo(page, sheet, a, b);
    const before = await stableOffset(page, sheet, moved, anchor);
    const root = await sheet.root.boundingBox();
    expect(root).not.toBeNull();
    if (!root) return;

    await page.keyboard.press("m");
    await expect(page.getByRole("status")).toContainText("Moving ");
    // A point in the open, clear of the tool strip (top-left) and the zoom readout (bottom-left).
    const dropX = root.x + root.width * 0.7;
    const dropY = root.y + root.height * 0.55;
    await page.mouse.click(dropX, dropY);

    await expect(page.getByRole("status")).toContainText(`Moved ${moved}`);
    await expect(async () => {
      const offset = await relativeOffset(sheet, moved, anchor);
      expect(offset).not.toBeNull();
      if (!offset) return;
      expect(offset.dx !== before.dx || offset.dy !== before.dy).toBe(true);
    }).toPass();

    await expect(async () => expect(await titleBar.undoControl()).not.toHaveAttribute("aria-disabled", "true")).toPass();
    await titleBar.undo();
    await expect(page.getByRole("status")).toContainText(undidLine(`Moved ${moved}`));
    await expectOffset(sheet, moved, anchor, before.dx, before.dy);
  });
});

test.describe("Nudge", () => {
  test("a burst of arrow presses moves the card, and one undo restores where it started before the burst @smoke", async ({
    page,
  }) => {
    const [a, b] = await placeTwo(page);
    const sheet = new SheetPage(page);
    const titleBar = new TitleBarPage(page);
    await zoomTo100(page, sheet);
    const { moved, anchor } = await focusFirstOfTwo(page, sheet, a, b);

    const before = await stableOffset(page, sheet, moved, anchor);
    // Three presses, well inside the 1 s burst window (`document-store.ts`'s `BURST_GAP_MS`): one undo step.
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");

    await expectOffset(sheet, moved, anchor, before.dx + 24, before.dy);

    await titleBar.undo();
    await expect(page.getByRole("status")).toContainText(undidLine(`Moved ${moved}`));
    await expectOffset(sheet, moved, anchor, before.dx, before.dy);
  });
});

test.describe("Tidy", () => {
  test("T tidies the whole sheet, the console says exactly how many facets, and one undo restores the layout @smoke", async ({
    page,
  }) => {
    const [a, b] = await placeTwo(page);
    const sheet = new SheetPage(page);
    const titleBar = new TitleBarPage(page);
    // Fit (⇧1) is a pure function of the sheet-space content bounds and the viewport size, so re-fitting after
    // undo reproduces the exact pre-tidy screen position — Tidy's own "view fits" (spec L476) changes zoom, and
    // pan is never an undo step (spec L492), so a screen box alone can't tell a real revert from a lucky one.
    await focusRegion(page, "Sheet");
    await page.keyboard.press("Shift+Digit1");
    const before = await stableCardBox(page, sheet, a);
    expect(before).not.toBeNull();
    if (!before) return;

    // T with nothing (or fewer than two) selected tidies the whole sheet (IR L28, `layout.ts`'s `tidyCommand`).
    await page.keyboard.press("t");

    await expect(consoleLog(page)).toContainText("Tidied 2 facets.");
    await expect(page.getByRole("status")).toContainText("Tidied 2 facets.");
    // The ad-hoc `place` position and the tidied one differ (see `placeTwo`), so this is a real move.
    const tidied = await sheet.cardBox(a);
    expect(tidied).not.toBeNull();
    if (tidied) expect(tidied.x !== before.x || tidied.y !== before.y).toBe(true);

    await titleBar.undo();
    await expect(page.getByRole("status")).toContainText(undidLine("Tidied 2 facets"));
    await focusRegion(page, "Sheet");
    await page.keyboard.press("Shift+Digit1");
    await expect(async () => {
      const box = await sheet.cardBox(a);
      expect(box).not.toBeNull();
      if (!box) return;
      expect(box.x).toBeCloseTo(before.x, 0);
      expect(box.y).toBeCloseTo(before.y, 0);
    }).toPass({ timeout: 5000 });
    void b;
  });

  test("Tidy selection, with two or more cards selected, arranges only those", async ({ page }) => {
    const [a, b] = await placeTwo(page);
    const sheet = new SheetPage(page);
    const beforeB = await sheet.cardBox(b);
    expect(beforeB).not.toBeNull();

    // Mouse only (a menu command, not a bare key): the header text, never the card's whole box (a click there
    // can land on a pin row instead — see this file's header comment).
    await sheet.card(a).getByText(a, { exact: true }).click();
    await sheet.card(b).getByText(b, { exact: true }).click({ modifiers: ["Shift"] });
    await expect(async () => expect(await sheet.isSelected(b)).toBe(true)).toPass();
    const menu = await openCardMenu(page, sheet, b);
    await menu.getByRole("menuitem", { name: "Tidy selection" }).click();

    await expect(consoleLog(page)).toContainText("Tidied 2 facets.");
    await expect(page.getByRole("status")).toContainText("Tidied 2 facets.");
    const afterB = await sheet.cardBox(b);
    expect(afterB).not.toBeNull();
    if (beforeB && afterB) expect(afterB.x !== beforeB.x || afterB.y !== beforeB.y).toBe(true);
  });

  test("the console verb `tidy` does the same, keyboard only", async ({ page }) => {
    await placeTwo(page);
    await runConsoleCommand(page, "tidy");
    await expect(consoleLog(page)).toContainText("Tidied 2 facets.");
  });
});

test.describe("Flip pins", () => {
  test("F flips the selected card's pin column, and one undo puts it back", async ({ page }) => {
    const name = await placeOne(page);
    const sheet = new SheetPage(page);
    const titleBar = new TitleBarPage(page);
    await focusOnlyCard(page, sheet, name);

    await page.keyboard.press("f");
    await expect(consoleLog(page)).toContainText(`Flipped pins on ${name}.`);
    await expect(page.getByRole("status")).toContainText(`Flipped pins on ${name}.`);

    await titleBar.undo();
    await expect(page.getByRole("status")).toContainText(undidLine(`Flipped pins on ${name}`));
  });
});

test.describe("Expand and collapse", () => {
  // ERC4626 has 17 selectors in this catalog (checked with `_support/catalog.ts`'s `catalog()`), well past the
  // 9-selector threshold (spec L479) that gives a card "+ n more" / Collapse.
  test("a card with more than 9 selectors offers Expand, which is a layout edit, and undo/redo move with it", async ({
    page,
  }) => {
    await seedProject(page, { project: recipeProject("GovernedVault", { filled: true }) });
    const sheet = new SheetPage(page);
    const titleBar = new TitleBarPage(page);
    await page.getByRole("tab", { name: "Structure" }).click();
    await page.getByRole("treeitem", { name: treeitemName("ERC4626") }).click();
    await expect(async () => expect(await sheet.isSelected("ERC4626")).toBe(true)).toPass();
    await expect.poll(() => sheet.zoomText()).toMatch(/^(7[5-9]|[89]\d|1\d\d|200)%$/);

    let menu = await openCardMenu(page, sheet, "ERC4626");
    await expect(menu.getByRole("menuitem", { name: "Expand" })).toBeVisible();
    await menu.getByRole("menuitem", { name: "Expand" }).click();

    await expect(consoleLog(page)).toContainText("Expanded ERC4626.");
    await expect(page.getByRole("status")).toContainText("Expanded ERC4626.");
    menu = await openCardMenu(page, sheet, "ERC4626");
    await expect(menu.getByRole("menuitem", { name: "Collapse" })).toBeVisible();
    await page.keyboard.press("Escape");

    await titleBar.undo();
    await expect(page.getByRole("status")).toContainText(undidLine("Expanded ERC4626"));
    menu = await openCardMenu(page, sheet, "ERC4626");
    await expect(menu.getByRole("menuitem", { name: "Expand" })).toBeVisible();
    await page.keyboard.press("Escape");

    await titleBar.redo();
    await expect(page.getByRole("status")).toContainText(redidLine("Expanded ERC4626"));
    menu = await openCardMenu(page, sheet, "ERC4626");
    await expect(menu.getByRole("menuitem", { name: "Collapse" })).toBeVisible();
    await menu.getByRole("menuitem", { name: "Collapse" }).click();
    await expect(consoleLog(page)).toContainText("Collapsed ERC4626.");
  });
});

test.describe("Zoom", () => {
  test("the readout's menu (50%, 100%, 200%, Fit, Selection) and ⇧0/⇧1/⇧2 change the displayed percent @smoke", async ({
    page,
  }) => {
    const name = await placeOne(page);
    const sheet = new SheetPage(page);
    await focusOnlyCard(page, sheet, name);

    let menu = await sheet.openZoomMenu();
    await menu.getByRole("menuitem", { name: "50%" }).click();
    await expect.poll(() => sheet.zoomText()).toBe("50%");

    menu = await sheet.openZoomMenu();
    await menu.getByRole("menuitem", { name: "200%" }).click();
    await expect.poll(() => sheet.zoomText()).toBe("200%");

    await focusRegion(page, "Sheet");
    await page.keyboard.press("Shift+Digit0");
    await expect.poll(() => sheet.zoomText()).toBe("100%");

    await page.keyboard.press("Shift+Digit2");
    await expect.poll(() => sheet.zoomText()).not.toBe("100%");

    await page.keyboard.press("Shift+Digit1");
    await expect.poll(() => sheet.zoomText()).toMatch(/^\d+%$/);
  });
});

test.describe("Locate", () => {
  test("clicking a placed facet in the Structure tree selects it and centers it at 75% zoom or more", async ({
    page,
  }) => {
    // 30 cards spread well apart (SEL-01), so the last one in the list starts well outside the view.
    const project = collisionsProject(30);
    await seedProject(page, { project });
    const sheet = new SheetPage(page);
    // The last card: the core's facets are in the recipe but never on the sheet (nor in the tree's facet rows).
    const target = project.recipe.facets.filter((name) => !isCoreFacet(name)).at(-1);
    expect(target).toBeDefined();
    if (!target) return;

    await page.getByRole("tab", { name: "Structure" }).click();
    await page.getByRole("treeitem", { name: treeitemName(target) }).click();

    await expect(async () => expect(await sheet.isSelected(target)).toBe(true)).toPass();
    await expect.poll(() => sheet.zoomText()).toMatch(/^(7[5-9]|[89]\d|1\d\d|200)%$/);
    const sheetBox = await sheet.root.boundingBox();
    const cardBox = await sheet.cardBox(target);
    expect(sheetBox).not.toBeNull();
    expect(cardBox).not.toBeNull();
    if (sheetBox && cardBox) {
      expect(cardBox.x).toBeGreaterThanOrEqual(sheetBox.x - 1);
      expect(cardBox.y).toBeGreaterThanOrEqual(sheetBox.y - 1);
      expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(sheetBox.x + sheetBox.width + 1);
      expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(sheetBox.y + sheetBox.height + 1);
    }
  });
});

test.describe("Back to content", () => {
  test("appears after every card has been off-screen for 1 s, and fits the view on click", async ({ page }) => {
    const project = collisionsProject(30);
    await seedProject(page, { project });
    const sheet = new SheetPage(page);
    const [first] = project.recipe.facets.filter((name) => !isCoreFacet(name));
    expect(first).toBeDefined();
    if (!first) return;

    const root = await sheet.root.boundingBox();
    expect(root).not.toBeNull();
    if (!root) return;
    await page.mouse.move(root.x + root.width / 2, root.y + root.height / 2);
    // Plain wheel pans by default (`contracts/stores.ts`'s `wheel: "pan"`). Bursts, not one giant scroll (which
    // the OS or the browser can coalesce away), repeated until the button actually shows: under a busy parallel
    // run, wheel events and the 1 s "every card off-screen" timer both slip, so a fixed burst count is flaky in
    // exactly the way a fixed-time wait always is.
    await expect(async () => {
      await page.mouse.wheel(0, 20000);
      await expect(sheet.backToContent).toBeVisible({ timeout: 500 });
    }).toPass({ timeout: 15_000, intervals: [300] });
    await sheet.backToContent.click();
    await expect(sheet.backToContent).toHaveCount(0);
    await expect(async () => expect(await sheet.cardBox(first)).not.toBeNull()).toPass();
  });
});

test.describe("Keyboard only (no pointer events after the page loads)", () => {
  test("Move to…, Nudge and Tidy, driven only from the keyboard", async ({ page }) => {
    const [a, b] = await placeTwo(page); // console typing is keyboard only; placing selects what it places.
    const sheet = new SheetPage(page);
    await zoomTo100(page, sheet);
    const { moved, anchor } = await focusFirstOfTwo(page, sheet, a, b); // sheet.focusFirst (Home), no pointer.

    const beforeMove = await stableOffset(page, sheet, moved, anchor);
    await page.keyboard.press("m");
    await expect(page.getByRole("status")).toContainText("Moving ");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status")).toContainText(`Moved ${moved}`);
    await expectOffset(sheet, moved, anchor, beforeMove.dx + 16, beforeMove.dy);

    const beforeNudge = await stableOffset(page, sheet, moved, anchor);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expectOffset(sheet, moved, anchor, beforeNudge.dx, beforeNudge.dy + 16);

    // `tidy` (bare, IR "Console verbs") has both cards to arrange, keyboard only via the console.
    await runConsoleCommand(page, "tidy");
    await expect(consoleLog(page)).toContainText("Tidied 2 facets.");
  });
});

for (const width of NARROW_WIDTHS) {
  test.describe(`at ${width} px`, () => {
    test.use({ viewport: viewportAt(width) });

    if (tierAt(width) === "phone") {
      test("below 768 px the tool strip is hidden; Tidy runs from the title bar's More > Tools menu", async ({
        page,
      }) => {
        await placeTwo(page);
        const sheet = new SheetPage(page);
        await expect(sheet.toolStrip).toHaveCount(0);

        await page.getByRole("region", { name: "Title bar" }).getByRole("button", { name: "More" }).click();
        await page.getByRole("menuitem", { name: "Tools" }).click();
        await page.getByRole("menuitem", { name: "Tidy" }).click();

        await expect(page.getByRole("status")).toContainText("Tidied 2 facets.");
      });
    } else {
      // At 768 px (the narrow tier) the tool strip renders exactly as it does at the desktop width (IR L110:
      // it only moves into the overflow menu below 768 px), so this is the same direct check as the @smoke
      // test above, not a different path — nothing about Tidy changes at this width.
      test("at 768 px the tool strip still shows Tidy directly", async ({ page }) => {
        await placeTwo(page);
        const sheet = new SheetPage(page);
        await sheet.toolButton("Tidy").click();
        await expect(page.getByRole("status")).toContainText("Tidied 2 facets.");
      });
    }
  });
}
