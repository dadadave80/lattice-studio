/**
 * Keyboard paths for the accessibility suite. Like the kit's `keys.ts`, they press keys and find controls by role
 * and accessible name only, but the modifier follows the platform the page reports instead of the machine the
 * test runs on: Playwright's `ControlOrMeta` presses ⌘ on a macOS host even when the page (Desktop Chrome) reports
 * Windows and Studio binds Ctrl, so the kit's `MOD` misses there. See the report's follow-ups (Q0).
 */
import { expect, type Locator, type Page } from "@playwright/test";
import { expectPaletteClosed, focusRegion, focusedRegion, pagePlatform, region } from "../../_support/keys.ts";

/** Studio's `Mod`: ⌘ where the page reports macOS, Ctrl elsewhere. */
export async function mod(page: Page): Promise<"Meta" | "Control"> {
  return (await pagePlatform(page)) === "mac" ? "Meta" : "Control";
}

/** Presses `Mod+key` (`"k"`, `"Enter"`). */
export async function pressMod(page: Page, key: string): Promise<void> {
  await page.keyboard.press(`${await mod(page)}+${key}`);
}

/** Whether `locator` holds focus right now. */
export async function isFocused(locator: Locator): Promise<boolean> {
  return (await locator.count()) === 1 && locator.evaluate((el) => el === document.activeElement);
}

/** The palette's input: the combobox named "Search commands, facets and recipes". */
export function paletteInput(page: Page): Locator {
  return page.getByRole("combobox", { name: "Search commands, facets and recipes" });
}

/** ⌘K / Ctrl+K, waiting for the palette's input to take focus. */
export async function openPalette(page: Page): Promise<Locator> {
  await pressMod(page, "k");
  const input = paletteInput(page);
  await expect(input).toBeFocused();
  return input;
}

/** The text of the palette's active row, or null. */
async function activeOption(input: Locator): Promise<string | null> {
  return input.evaluate((el) => {
    const id = el.getAttribute("aria-activedescendant");
    return (id ? document.getElementById(id)?.textContent : null) ?? null;
  });
}

/**
 * Opens the palette, types `query`, waits for the active row to name it (as `_support/keys.ts` does: the row
 * contains the query, since titles are a verb and its object: "Projects" finds "Open Projects"), presses Enter and
 * waits for it to close.
 */
export async function runInPalette(page: Page, query: string): Promise<void> {
  const input = await openPalette(page);
  await input.fill(query);
  await expect
    .poll(async () => (await activeOption(input))?.toLowerCase().includes(query.toLowerCase()) ?? false, {
      message: `the palette's active row should be "${query}"`,
    })
    .toBe(true);
  await page.keyboard.press("Enter");
  await expectPaletteClosed(page, query);
}

/** The console's command line. */
export function commandLine(page: Page): Locator {
  return region(page, "Console").getByRole("textbox", { name: "Command line" });
}

/** F6 to the Console region, then Tab until the command line (its last stop) has focus. */
export async function focusCommandLine(page: Page): Promise<Locator> {
  const input = commandLine(page);
  if (await isFocused(input)) return input;
  await focusRegion(page, "Console");
  for (let presses = 0; presses < 80 && !(await isFocused(input)); presses += 1) {
    await page.keyboard.press("Tab");
    if ((await focusedRegion(page)) !== "Console" && !(await isFocused(input))) {
      throw new Error("Tab left the Console region before reaching the command line.");
    }
  }
  await expect(input).toBeFocused();
  return input;
}

/** Types one console line and presses Enter, keyboard only. */
export async function runConsole(page: Page, line: string): Promise<void> {
  await focusCommandLine(page);
  await page.keyboard.type(line);
  await page.keyboard.press("Enter");
}

/** Tabs forward until `target` holds focus, failing after `limit` presses. */
export async function tabTo(page: Page, target: Locator, limit = 120): Promise<void> {
  for (let presses = 0; presses < limit; presses += 1) {
    if (await isFocused(target)) return;
    await page.keyboard.press("Tab");
  }
  await expect(target).toBeFocused();
}

/**
 * Waits until the sheet's canvas and its interaction layer have loaded (they arrive after the first paint): the
 * sheet's tool strip is there and a card, or the empty state, is drawn.
 */
export async function waitForSheet(page: Page): Promise<void> {
  const sheet = region(page, "Sheet");
  await expect(sheet.getByRole("toolbar", { name: "Sheet tools" })).toBeVisible();
  const card = sheet.getByRole("group", { name: / \d+ selectors?/ });
  await expect(card.or(sheet.getByRole("region", { name: "Start a diamond" })).first()).toBeVisible();
}
