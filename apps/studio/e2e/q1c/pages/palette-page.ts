/**
 * `_support/keys.ts`'s `openPalette` and `runInPalette`, reimplemented with the working chord (see
 * `mod-key.ts`'s doc comment). Everything else is the same: roles and accessible names only (IR "Command
 * palette").
 */
import { expect, type Locator, type Page } from "@playwright/test";
import { pressMod } from "./mod-key.ts";

async function focusedRole(page: Page): Promise<string | null> {
  return page.evaluate(() => document.activeElement?.getAttribute("role") ?? null);
}

/** ⌘/Ctrl K, then waits for the palette's combobox to take focus (IR "Command palette"). */
export async function openPalette(page: Page): Promise<Locator> {
  await pressMod(page, "k");
  await expect.poll(() => focusedRole(page), { message: "⌘K should focus the palette's combobox" }).toBe("combobox");
  const comboboxes = page.getByRole("combobox");
  for (let i = 0; i < (await comboboxes.count()); i += 1) {
    const candidate = comboboxes.nth(i);
    if (await candidate.evaluate((el) => el === document.activeElement)) {
      await expect(candidate).toBeFocused();
      return candidate;
    }
  }
  throw new Error("⌘K focused a combobox that the accessibility tree doesn't list.");
}

async function activeOptionText(input: Locator): Promise<string | null> {
  return input.evaluate((el) => {
    const id = el.getAttribute("aria-activedescendant");
    const option = id ? document.getElementById(id) : null;
    return option?.textContent ?? null;
  });
}

/**
 * Opens the palette, types `query`, waits until the active row names it, and presses Enter (keyboard only).
 * Then waits for the palette to actually close: running a command that closes it (any `facet.place` row)
 * still leaves its closing transition in flight for a moment, and a `⌘K` pressed into that window is lost (a
 * real timing gap, found while writing this file — see the WP-Q1c report's Follow-ups). Chaining two
 * `runInPalette` calls back to back needs this so the second one's `⌘K` lands on a page that's actually ready.
 */
export async function runInPalette(page: Page, query: string): Promise<void> {
  const input = await openPalette(page);
  await input.fill(query);
  await expect
    .poll(async () => (await activeOptionText(input))?.toLowerCase().includes(query.toLowerCase()) ?? false, {
      message: `the palette's active row should be "${query}"`,
    })
    .toBe(true);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("combobox")).toHaveCount(0);
}
