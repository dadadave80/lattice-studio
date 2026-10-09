/**
 * The manual scripts' claims that depend on how MANUAL.md builds its start states (Empty, ERC20 and Collisions from
 * the keyboard, not seeded), checked the way the manual runs them. A step here failing means the manual says
 * something the app doesn't do: fix the step, or the app.
 */
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../_support/fixtures.ts";
import { focusRegion, focusedRegion, region } from "../_support/keys.ts";
import { openEmpty } from "../_support/seed.ts";
import { SheetPage } from "../q1c/pages/sheet-page.ts";
import { commandLine, pressMod, runConsole, runInPalette, tabTo, waitForSheet } from "./support/keyboard.ts";

/** `document-store.ts`'s `BURST_GAP_MS`: presses further apart than this start a new undo step. */
const BURST_GAP_MS = 1000;

/** The announcer's polite region: what a screen reader reads after a pause. */
function spoken(page: Page): Locator {
  return page.locator('[data-announcer="status"]');
}

/** The manual's Empty: a new project with nothing placed. */
async function startEmpty(page: Page): Promise<void> {
  await openEmpty(page);
  await waitForSheet(page);
}

/** The manual's ERC20: from Empty, Tab to ERC20 in the Start a diamond block and press Enter. */
async function startErc20(page: Page): Promise<void> {
  await startEmpty(page);
  await focusRegion(page, "Sheet");
  await tabTo(page, region(page, "Sheet").getByRole("region", { name: "Start a diamond" }).getByRole("button", { name: /^ERC20/ }));
  await page.keyboard.press("Enter");
  await expect(new SheetPage(page).card("ERC20")).toBeVisible();
}

const COLLISIONS = ["AxelarGatewayAdapter", "ZetaChainGatewayAdapter", "CCIPGatewayAdapter"] as const;

/** The manual's Collisions: from Empty, three `place` commands in the console. */
async function startCollisions(page: Page): Promise<void> {
  await startEmpty(page);
  for (const facet of COLLISIONS) {
    await runConsole(page, `place ${facet.toLowerCase()}`);
    await expect(new SheetPage(page).card(facet)).toBeVisible();
  }
}

type Offset = { dx: number; dy: number };

/** Where `moved` sits relative to `anchor`, once it stops changing: pan and zoom drop out. */
async function offset(page: Page, sheet: SheetPage, moved: string, anchor: string): Promise<Offset> {
  const read = async (): Promise<Offset | null> => {
    const [m, a] = [await sheet.cardBox(moved), await sheet.cardBox(anchor)];
    return m && a ? { dx: Math.round(m.x - a.x), dy: Math.round(m.y - a.y) } : null;
  };
  let last = await read();
  for (let i = 0; i < 20; i += 1) {
    await page.waitForTimeout(100);
    const next = await read();
    if (last && next && last.dx === next.dx && last.dy === next.dy) return next;
    last = next;
  }
  throw new Error(`${moved} kept moving relative to ${anchor}`);
}

test.describe("start states", () => {
  test("ERC20 leaves focus on the Sheet region, and Home moves it to the ERC20 card", async ({ page }) => {
    await startErc20(page);
    await expect(region(page, "Sheet")).toBeFocused();
    await page.keyboard.press("Home");
    await expect(new SheetPage(page).card("ERC20")).toBeFocused();
  });

  test("Collisions leaves focus on the command line, so F6 starts the cycle at the Title bar and lands on the Sheet region", async ({ page }) => {
    await startCollisions(page);
    await expect(commandLine(page)).toBeFocused();
    const visited: (string | null)[] = [];
    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press("F6");
      visited.push(await focusedRegion(page));
      if (visited.length === 3) await expect(region(page, "Sheet")).toBeFocused();
    }
    expect(visited).toEqual(["Title bar", "Left pane", "Sheet", "Inspector", "Console", "Title bar"]);
  });
});

test.describe("S2 · F6 and Ctrl+F6, with a toast showing", () => {
  test("after the toast's Undo, five F6 presses come back to the restored card, and closing Settings returns there", async ({ page }) => {
    await startCollisions(page);
    const sheet = new SheetPage(page);
    const [first] = COLLISIONS;
    await focusRegion(page, "Sheet");
    await page.keyboard.press("Home");
    await expect(sheet.card(first)).toBeFocused();
    await pressMod(page, "a");
    await page.keyboard.press("Delete");
    await focusRegion(page, "Notifications");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(region(page, "Notifications").getByRole("button", { name: "Undo", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(sheet.card(first)).toBeFocused();
    // Step 7 comes after the toast has gone; it leaves with a short exit.
    await expect(region(page, "Notifications").getByRole("dialog")).toHaveCount(0);

    const visited: (string | null)[] = [];
    for (let i = 0; i < 5; i += 1) {
      await page.keyboard.press("F6");
      visited.push(await focusedRegion(page));
    }
    expect(visited).toEqual(["Inspector", "Console", "Title bar", "Left pane", "Sheet"]);
    await expect(sheet.card(first)).toBeFocused();

    await runInPalette(page, "Open Settings");
    const settings = page.getByRole("dialog", { name: "Settings", exact: true });
    await expect(settings).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(settings).toBeHidden();
    await expect(sheet.card(first)).toBeFocused();
  });
});

test.describe("S1 · skip to sheet", () => {
  test("in the core cell, the sixth ↓ wraps back to the cell's heading", async ({ page }) => {
    await startErc20(page);
    const sheet = region(page, "Sheet");
    const core = sheet.getByRole("button", { name: /^Core / });
    await tabTo(page, core);
    for (let i = 0; i < 5; i += 1) await page.keyboard.press("ArrowDown");
    await expect(sheet.getByRole("button", { name: /^Cut / })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(core).toBeFocused();
  });
});

/** The context menu's items' accessible names, in order, as the accessibility tree reports them. */
async function menuItems(page: Page, name: string): Promise<string[]> {
  const menu = page.getByRole("menu", { name, exact: true });
  await expect(menu).toBeVisible();
  return [...(await menu.ariaSnapshot()).matchAll(/menuitem "([^"]*)"/g)].map((match) => match[1] ?? "");
}

test.describe("S4 · Move to… without dragging", () => {
  test("the card's menu has Expand, and the Structure tree's menu, reached as step 9 says, is the same without it", async ({ page }) => {
    await startCollisions(page);
    const [first] = COLLISIONS;
    const menu = `${first} actions`;
    const items = ["Open in inspector", "Locate", "Move to…", "Flip pins", "Route contested selectors here", "Remove"];
    await focusRegion(page, "Sheet");
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+F10");
    expect(await menuItems(page, menu)).toEqual([...items.slice(0, 4), "Expand", ...items.slice(4)]);
    await page.keyboard.press("Escape");
    await expect(new SheetPage(page).card(first)).toBeFocused();

    await focusRegion(page, "Left pane");
    const pane = region(page, "Left pane");
    await page.keyboard.press("Tab");
    await expect(pane.getByRole("tab", { name: "Catalog" })).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    // The Structure tree loads on first show; a person hears "Showing Structure." before tabbing on.
    const row = pane.getByRole("treeitem", { name: new RegExp(`^${first},`) });
    await expect(row).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(pane.getByRole("tabpanel", { name: "Structure" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(row).toBeFocused();
    await page.keyboard.press("Shift+F10");
    expect(await menuItems(page, menu)).toEqual(items);
  });
});

test.describe("S8 · palette, dialogs and menus", () => {
  test("F6 to the Console returns to the command line, and ⇧Tab reaches Export", async ({ page }) => {
    await startCollisions(page);
    await focusRegion(page, "Sheet");
    await focusRegion(page, "Console");
    await expect(commandLine(page)).toBeFocused();
    const exportButton = region(page, "Console").getByRole("button", { name: "Export", exact: true });
    for (let presses = 0; presses < 12 && !(await exportButton.evaluate((el) => el === document.activeElement)); presses += 1) {
      await page.keyboard.press("Shift+Tab");
      expect(await focusedRegion(page)).toBe("Console");
    }
    await expect(exportButton).toBeFocused();
  });
});

test.describe("S5 · merged nudge announcements", () => {
  test("two bursts with a pause between are two undo steps, and the next Mod+Z undoes the last placement", async ({ page }) => {
    await startCollisions(page);
    const sheet = new SheetPage(page);
    const [moved, anchor] = COLLISIONS;
    await focusRegion(page, "Sheet");
    await page.keyboard.press("Home");
    await expect.poll(() => sheet.isSelected(moved)).toBe(true);
    const start = await offset(page, sheet, moved, anchor);

    for (let i = 0; i < 5; i += 1) await page.keyboard.press("ArrowRight");
    await expect(spoken(page)).toContainText(`Moved ${moved} right`);
    const afterRight = await offset(page, sheet, moved, anchor);
    expect(afterRight).not.toEqual(start);

    // Step 2 waits for step 1's message, which is always longer than the burst gap.
    await page.waitForTimeout(BURST_GAP_MS + 200);
    await page.keyboard.press("Shift+ArrowUp");
    await page.keyboard.press("Shift+ArrowUp");
    await expect(spoken(page)).toContainText(`Moved ${moved} up`);
    expect(await offset(page, sheet, moved, anchor)).not.toEqual(afterRight);

    await pressMod(page, "z");
    await expect(spoken(page)).toContainText(`Undid: Moved ${moved}.`);
    await expect.poll(() => offset(page, sheet, moved, anchor)).toEqual(afterRight);
    await pressMod(page, "z");
    await expect.poll(() => offset(page, sheet, moved, anchor)).toEqual(start);
    await pressMod(page, "z");
    await expect(spoken(page)).toContainText("Undid: Placed CCIPGatewayAdapter.");
  });
});

test.describe("S6 · focus after delete and undo", () => {
  test("Tidy and Flip run on the two cards step 4 leaves, and a new project starts with both history buttons unavailable", async ({ page }) => {
    await startCollisions(page);
    const sheet = new SheetPage(page);
    const [first, middle, last] = COLLISIONS;
    await focusRegion(page, "Sheet");
    await page.keyboard.press("Home");
    await pressMod(page, "ArrowRight");
    await expect(sheet.card(middle)).toBeFocused();
    // Steps 1 to 3: remove the middle card, undo, redo.
    await page.keyboard.press("Delete");
    await expect(sheet.card(last)).toBeFocused();
    await pressMod(page, "z");
    await expect(sheet.card(middle)).toBeFocused();
    await pressMod(page, "Shift+z");
    await expect(spoken(page)).toContainText(`Redid: Removed ${middle}.`);
    // Step 4: undo, then remove the last card; focus moves to the previous one.
    await pressMod(page, "z");
    await page.keyboard.press("End");
    await expect(sheet.card(last)).toBeFocused();
    await page.keyboard.press("Delete");
    await expect(sheet.card(middle)).toBeFocused();
    // Step 5: remove both that are left, and bring them back.
    await pressMod(page, "a");
    await page.keyboard.press("Backspace");
    await expect(region(page, "Sheet")).toBeFocused();
    await pressMod(page, "z");
    await expect(sheet.card(first)).toBeFocused();
    // Step 6.
    await pressMod(page, "a");
    await page.keyboard.press("t");
    await expect(spoken(page)).toContainText(/Tidied 2 facets\.|Nothing moved: the sheet already has this layout\./);
    await page.keyboard.press("Home");
    await page.keyboard.press("f");
    await expect(spoken(page)).toContainText("Flipped pins on");
    // Something to redo, so the new project has to clear it.
    await pressMod(page, "z");
    await expect(spoken(page)).toContainText("Undid: Flipped pins on");

    await runInPalette(page, "New project");
    await waitForSheet(page);
    const bar = region(page, "Title bar");
    const undo = bar.getByRole("button", { name: "Undo", exact: true });
    const redo = bar.getByRole("button", { name: "Redo", exact: true });
    await focusRegion(page, "Title bar");
    await tabTo(page, undo);
    await expect(undo).toHaveAttribute("aria-disabled", "true");
    await expect(undo).toHaveAccessibleDescription("Nothing to undo");
    await tabTo(page, redo);
    await expect(redo).toHaveAttribute("aria-disabled", "true");
    await expect(redo).toHaveAccessibleDescription("Nothing to redo");
    await pressMod(page, "z");
    // Whether the refusal or the run says it, the words are the same; the run adds a period.
    await expect(spoken(page)).toContainText("Nothing to undo");
  });
});

test.describe("S7 · shortcuts switched off", () => {
  test("F6 alone reaches the Sheet, not a card; after Home, closing Settings returns focus to the card, and ↓ reaches Hand", async ({ page }) => {
    await startCollisions(page);
    const sheet = new SheetPage(page);
    const [first] = COLLISIONS;
    // Nothing on the sheet has had focus yet, so F6 lands on the region (regions.ts `focusRegion`).
    await focusRegion(page, "Sheet");
    await expect(region(page, "Sheet")).toBeFocused();
    await page.keyboard.press("Home");
    await expect(sheet.card(first)).toBeFocused();

    await runInPalette(page, "Open Settings");
    const settings = page.getByRole("dialog", { name: "Settings", exact: true });
    await expect(settings).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect(settings.getByRole("tab", { name: "Keyboard" })).toBeFocused();
    await page.keyboard.press("Enter");
    const singleKeys = settings.getByRole("switch", { name: "Single-key shortcuts" });
    await tabTo(page, singleKeys);
    await page.keyboard.press("Space");
    await expect(singleKeys).not.toBeChecked();
    await page.keyboard.press("Escape");
    await expect(settings).toBeHidden();
    await expect(sheet.card(first)).toBeFocused();

    // Step 8: the tool strip is one stop on Select, and ↓ moves to Hand, which no longer names a shortcut.
    const tools = region(page, "Sheet").getByRole("toolbar", { name: "Sheet tools" });
    await tabTo(page, tools.getByRole("button", { name: "Select", exact: true }));
    await page.keyboard.press("ArrowDown");
    const hand = tools.getByRole("button", { name: "Hand", exact: true });
    await expect(hand).toBeFocused();
    await expect(hand).not.toHaveAttribute("aria-keyshortcuts");
  });
});

test.describe("S9 · deploy, with paste", () => {
  test("the review is named for the project, which the ERC20 start state leaves Untitled; Esc returns to Lattice Studio", async ({ page }) => {
    await startErc20(page);
    await focusRegion(page, "Title bar");
    await pressMod(page, "Enter");
    const review = page.getByRole("dialog", { name: "Deploy Untitled", exact: true });
    await expect(review).toBeVisible({ timeout: 20_000 });
    await expect(review.getByRole("heading", { name: "Deploy Untitled" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(review).toBeHidden();
    await expect(region(page, "Title bar").getByRole("button", { name: "Lattice Studio", exact: true })).toBeFocused();
  });
});
