/**
 * Flow 9. Undo and redo (spec L488-L494).
 *
 * 1. ⌘/Ctrl+Z and ⇧⌘/Ctrl+Z (Ctrl+Y too on Windows), the title-bar buttons, the palette or console `undo`.
 * 2. One step each: place, remove, a whole drag, a burst of nudges, a pin toggle, an owner choice, a committed
 *    init field, a reorder, tidy, flip, expand, a recipe load or replace, an import.
 * 3. Never steps: selection, viewport, theme, pane sizes, tabs, modes, deployments.
 * 4. Undo restores the selection that went with the step and scrolls the changed card into view. The status
 *    region and a dim console line say "Undid: Placed ERC20".
 * 5. 200 steps per project, for the session. When history resets (a catalog migration, taking over from
 *    another tab), the console says so.
 *
 * Two placements build the history this file exercises: `place erc20` then `place erc4626` (IR "Console
 * verbs"). Placing selects the facet it places (`state/cmd/facets.ts`'s `placeCommand`), so undoing the second
 * placement is also the vehicle for §4's selection and scroll-into-view claims: the document store's
 * `keepSelection` writes the *live* selection into the snapshot being left just before the next step is taken,
 * so the "Placed ERC4626" step is undone back onto a snapshot whose selection is "ERC20" (S1's
 * `document-store.ts`, confirmed against `state/commands.test.ts`'s `undoLabel` assertions).
 *
 * Two environment issues this file works around locally rather than depending on (see the WP-Q1c report's
 * Follow-ups):
 * - `_support/keys.ts`'s `MOD` ("ControlOrMeta") doesn't fire as a `page.keyboard.press` chord on this
 *   Playwright build; `pages/mod-key.ts` presses the platform's real modifier instead.
 * - Its `runConsole` and `openPalette` inherit that (and `runConsole`'s Tab-hunt undercounts once the Log
 *   holds more than a couple of lines); `pages/console-page.ts` and `pages/palette-page.ts` are this file's
 *   fixed equivalents.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "../_support/fixtures.ts";
import { openEmpty } from "../_support/seed.ts";
import { NARROW_WIDTHS, tierAt, viewportAt } from "../_support/viewports.ts";
import { consoleLog, runConsoleCommand } from "./pages/console-page.ts";
import { pressMod } from "./pages/mod-key.ts";
import { openPalette, runInPalette } from "./pages/palette-page.ts";
import { SheetPage } from "./pages/sheet-page.ts";
import { TitleBarPage } from "./pages/title-bar-page.ts";

const UNDID_LINE = "Undid: Placed ERC4626.";
const REDID_LINE = "Redid: Placed ERC4626.";
const NOTHING_TO_UNDO = "Nothing to undo";

/** `place erc20` then `place erc4626`, keyboard only (console typing). Placing selects what it places. */
async function placeTwoFacets(page: Page): Promise<void> {
  await runConsoleCommand(page, "place erc20");
  await runConsoleCommand(page, "place erc4626");
}

/**
 * The same two placements through the palette's "Place facet" group (IR "Command palette") instead of the
 * console. ⌘/Ctrl+Z is live everywhere but text fields (IR "Keyboard"), and the console's command line keeps
 * focus after typing into it, so a spec that presses ⌘Z or ⌘K next needs a setup that doesn't end there.
 */
async function placeTwoFacetsViaPalette(page: Page): Promise<void> {
  await runInPalette(page, "Place ERC20");
  await runInPalette(page, "Place ERC4626");
}

async function expectUndone(sheet: SheetPage, page: Page): Promise<void> {
  await expect(sheet.card("ERC4626")).toHaveCount(0);
  await expect(sheet.card("ERC20")).toBeVisible();
  await expect(page.getByRole("status")).toContainText(UNDID_LINE);
  await expect(consoleLog(page)).toContainText(UNDID_LINE);
  // §4: the selection restores to what it was before the undone step ("ERC20", the previous placement).
  await expect(async () => expect(await sheet.isSelected("ERC20")).toBe(true)).toPass();
  // §4: the changed card scrolls into view — its box sits inside the Sheet region's box.
  const sheetBox = await sheet.root.boundingBox();
  const cardBox = await sheet.cardBox("ERC20");
  expect(sheetBox).not.toBeNull();
  expect(cardBox).not.toBeNull();
  if (sheetBox && cardBox) {
    expect(cardBox.x).toBeGreaterThanOrEqual(sheetBox.x - 1);
    expect(cardBox.y).toBeGreaterThanOrEqual(sheetBox.y - 1);
    expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(sheetBox.x + sheetBox.width + 1);
    expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(sheetBox.y + sheetBox.height + 1);
  }
}

async function expectRedone(sheet: SheetPage, page: Page): Promise<void> {
  await expect(sheet.card("ERC4626")).toBeVisible();
  await expect(page.getByRole("status")).toContainText(REDID_LINE);
  await expect(consoleLog(page)).toContainText(REDID_LINE);
}

test("undoes and redoes a placement from the title bar, with the status line and the dim console note @smoke", async ({ page }) => {
  await openEmpty(page);
  const sheet = new SheetPage(page);
  const titleBar = new TitleBarPage(page);
  await placeTwoFacets(page);
  await expect(sheet.card("ERC4626")).toBeVisible();

  await titleBar.undo();
  await expectUndone(sheet, page);

  await titleBar.redo();
  await expectRedone(sheet, page);
});

test("the same flow, keyboard only (no pointer events after the page loads)", async ({ page }) => {
  await openEmpty(page);
  const sheet = new SheetPage(page);
  await placeTwoFacetsViaPalette(page);
  await expect(sheet.card("ERC4626")).toBeVisible();

  await pressMod(page, "z");
  await expectUndone(sheet, page);

  await pressMod(page, "Shift+z");
  await expectRedone(sheet, page);
});

test("the console verbs undo and redo do the same (IR: tidy, fit, init, undo, redo, bare)", async ({ page }) => {
  await openEmpty(page);
  const sheet = new SheetPage(page);
  await placeTwoFacets(page);

  await runConsoleCommand(page, "undo");
  await expectUndone(sheet, page);

  await runConsoleCommand(page, "redo");
  await expectRedone(sheet, page);
});

test("the palette runs Undo and Redo too", async ({ page }) => {
  await openEmpty(page);
  const sheet = new SheetPage(page);
  await placeTwoFacetsViaPalette(page);

  const input = await openPalette(page);
  await input.fill("Undo");
  await page.keyboard.press("Enter");
  await expectUndone(sheet, page);

  const redoInput = await openPalette(page);
  await redoInput.fill("Redo");
  await page.keyboard.press("Enter");
  await expectRedone(sheet, page);
});

test("Undo is disabled with its reason when history is empty, and the console verb says so too", async ({ page }) => {
  await openEmpty(page);
  const titleBar = new TitleBarPage(page);

  const undoControl = await titleBar.undoControl();
  await expect(undoControl).toHaveAttribute("aria-disabled", "true");
  await expect(undoControl).toHaveAccessibleDescription(NOTHING_TO_UNDO);

  await runConsoleCommand(page, "undo");
  await expect(page.getByRole("status")).toContainText(NOTHING_TO_UNDO);
  await expect(consoleLog(page)).toContainText(NOTHING_TO_UNDO);
});

for (const width of NARROW_WIDTHS) {
  test.describe(`at ${width} px, where Undo and Redo move (IR L74: below 768 px, into "More")`, () => {
    test.use({ viewport: viewportAt(width) });

    test(`undoes and redoes through ${tierAt(width) === "phone" ? "the overflow menu" : "the title bar"}`, async ({ page }) => {
      await openEmpty(page);
      const sheet = new SheetPage(page);
      const titleBar = new TitleBarPage(page);
      // The palette is an overlay above every pane, so this setup doesn't depend on which pane the narrow or
      // phone tier's switcher currently shows (unlike the console, which is its own pane below 768 px).
      await runInPalette(page, "Place ERC20");
      await expect(sheet.card("ERC20")).toBeVisible();

      await titleBar.undo();
      await expect(sheet.card("ERC20")).toHaveCount(0);

      await titleBar.redo();
      await expect(sheet.card("ERC20")).toBeVisible();
    });
  });
}
