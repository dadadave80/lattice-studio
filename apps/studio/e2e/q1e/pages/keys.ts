/**
 * Keyboard paths for Flows 12-14, on top of `_support/keys.ts`.
 *
 * Two differences from the kit, both about reaching controls the kit's helpers can't reach today:
 * - The modifier comes from the platform the page reports (`pagePlatform`), the way Studio binds `Mod`. The kit's
 *   `MOD` is Playwright's `ControlOrMeta`, which is ⌘ on a macOS host even when the Chromium project reports Windows
 *   (and Studio binds Ctrl there).
 * - The console's command line sits after the header, the Log's tag filters, its search and menus and the log
 *   itself, so Tab takes more than the kit's 20 presses to reach it once the console body has loaded.
 */
import { expect, type Locator, type Page } from "@playwright/test";
import { focusRegion, pagePlatform, region } from "../../_support/keys.ts";

/** "Meta" where Studio binds ⌘, "Control" where it binds Ctrl. */
export async function modKey(page: Page): Promise<"Meta" | "Control"> {
  return (await pagePlatform(page)) === "mac" ? "Meta" : "Control";
}

/** Presses ⌘/Ctrl + `key` as Studio binds it on this page's platform. */
export async function pressMod(page: Page, key: string): Promise<void> {
  await page.keyboard.press(`${await modKey(page)}+${key}`);
}

/** The palette's input (IR "Command palette"). */
export function paletteInput(page: Page): Locator {
  return page.getByRole("combobox", { name: "Search commands, facets and recipes" });
}

/** The text of the palette's active row, or null. */
async function activeRow(input: Locator): Promise<string | null> {
  return input.evaluate((el) => {
    const id = el.getAttribute("aria-activedescendant");
    return id ? (document.getElementById(id)?.textContent ?? null) : null;
  });
}

/**
 * Runs a command through the palette, keyboard only: ⌘/Ctrl K, type `title`, wait until the active row starts with
 * it, Enter.
 */
export async function runPalette(page: Page, title: string): Promise<void> {
  await pressMod(page, "k");
  const input = paletteInput(page);
  await expect(input).toBeFocused();
  await input.fill(title);
  await expect
    .poll(async () => (await activeRow(input))?.startsWith(title) ?? false, { message: `the palette's active row should be "${title}"` })
    .toBe(true);
  await page.keyboard.press("Enter");
  await expect(input).toBeHidden();
}

/**
 * Runs a command through the palette as `mode` says: the keyboard path above, or with the pointer: the title bar's
 * ⌘K chip, then a click on the command's row.
 */
export async function runPaletteWith(page: Page, mode: InputMode, title: string): Promise<void> {
  if (mode === "keyboard") {
    await runPalette(page, title);
    return;
  }
  await region(page, "Title bar").getByRole("button", { name: /Command palette$/ }).click();
  const input = paletteInput(page);
  await expect(input).toBeVisible();
  await input.fill(title);
  await page.getByRole("option").filter({ hasText: title }).first().click();
  await expect(input).toBeHidden();
}

/** The console's command line. */
export function commandLine(page: Page): Locator {
  return region(page, "Console").getByRole("textbox", { name: "Command line" });
}

/** Whether `target` holds focus. */
async function isFocused(target: Locator): Promise<boolean> {
  return (await target.count()) === 1 && (await target.evaluate((el) => el === document.activeElement));
}

/** Presses Tab until `target` holds focus (at most `max` presses), then checks it does. */
export async function tabTo(page: Page, target: Locator, max = 80): Promise<void> {
  for (let presses = 0; presses < max && !(await isFocused(target)); presses += 1) await page.keyboard.press("Tab");
  await expect(target).toBeFocused();
}

/**
 * Moves focus to the console's command line, keyboard only. Where the pane switcher hides the console (below
 * 768 px), "Go to console" shows it; where the console is collapsed to its summary (768-1023 px), F6 reaches its
 * header and Expand console opens it.
 */
export async function focusCommandLine(page: Page): Promise<void> {
  const input = commandLine(page);
  if (await isFocused(input)) return;
  const console = region(page, "Console");
  if (!(await console.isVisible())) await runPalette(page, "Go to console");
  const expand = console.getByRole("button", { name: "Expand console", exact: true });
  if (await expand.isVisible()) {
    await focusRegion(page, "Console");
    await tabTo(page, expand, 10);
    await page.keyboard.press("Enter");
  }
  await expect(input).toBeVisible();
  await focusRegion(page, "Console");
  await tabTo(page, input, 60);
}

export type InputMode = "pointer" | "keyboard";

/**
 * Activates `target` the way `mode` says: a click, or Tab until it holds focus and Enter. Keyboard variants call
 * it after putting focus where the control's Tab order starts (a region, a dialog).
 */
export async function activate(page: Page, mode: InputMode, target: Locator): Promise<void> {
  if (mode === "pointer") {
    await target.click();
    return;
  }
  await tabTo(page, target);
  await page.keyboard.press("Enter");
}

/** Types one console line and presses Enter, keyboard only. */
export async function runConsoleLine(page: Page, line: string): Promise<void> {
  await focusCommandLine(page);
  await page.keyboard.type(line);
  await page.keyboard.press("Enter");
}

/** The focused element's accessible label or text, for assertions about where focus went. */
export async function focusedLabel(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el) return "";
    return el.getAttribute("aria-label") ?? el.textContent ?? "";
  });
}
