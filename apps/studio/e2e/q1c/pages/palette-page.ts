/**
 * `_support/keys.ts`'s `openPalette` (FX26 fixed it to read the modifier from the page's own platform, not the
 * test host's) re-exported, plus a `runInPalette` that also waits for the palette to actually finish closing:
 * running a command that closes it still leaves its closing transition in flight for a moment, and a ⌘K
 * pressed into that window is lost. Chaining two `runInPalette` calls back to back needs that wait so the
 * second one's ⌘K lands on a page that's actually ready.
 */
import { expect, type Locator, type Page } from "@playwright/test";
import { openPalette } from "../../_support/keys.ts";

export { openPalette } from "../../_support/keys.ts";

async function activeOptionText(input: Locator): Promise<string | null> {
  return input.evaluate((el) => {
    const id = el.getAttribute("aria-activedescendant");
    const option = id ? document.getElementById(id) : null;
    return option?.textContent ?? null;
  });
}

/** Opens the palette, types `query`, waits until the active row names it, and presses Enter (keyboard only). */
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
