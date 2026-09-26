/**
 * A fix for `_support/keys.ts`'s `MOD` constant on this run: Playwright's `"ControlOrMeta"` resolves on the
 * *host* OS running Playwright, not on the page's detected platform. Under the `chromium` project (Desktop
 * Chrome), the page's `navigator.userAgentData.platform` (Client Hints) reports a non-mac platform even on a
 * macOS host, while the legacy `navigator.platform` still (truthfully) says "MacIntel"; Studio's own
 * `detectPlatform` (`src/ui/shared/platform.ts`) and this kit's `pagePlatform` (`_support/keys.ts`) both read
 * Client Hints first and land on `"other"` — so Studio binds `Mod` to Ctrl there. A macOS host's Playwright,
 * asked for `"ControlOrMeta"`, sends Meta regardless, so every `Mod` shortcut run through `_support/keys.ts`'s
 * `MOD` is dead in `chromium` on a macOS host (`webkit-smoke`'s real Safari UA agrees with the host, so it's
 * unaffected). Reported as a Follow-up to Q0 in the WP-Q1d report; every Q1d spec uses this file's `openPalette`
 * and `runInPalette` instead of `_support/keys.ts`'s.
 */
import { expect, type Locator, type Page } from "@playwright/test";
import { pagePlatform } from "../../_support/keys.ts";

/** "Meta" or "Control", matching what Studio's own platform detection resolves to for this page (not the host's). */
export async function mod(page: Page): Promise<"Meta" | "Control"> {
  return (await pagePlatform(page)) === "mac" ? "Meta" : "Control";
}

async function focusedRole(page: Page): Promise<string | null> {
  return page.evaluate(() => document.activeElement?.getAttribute("role") ?? null);
}

/** `_support/keys.ts`'s `openPalette`, using the page's own Mod key. */
export async function openPalette(page: Page): Promise<Locator> {
  await page.keyboard.press(`${await mod(page)}+k`);
  await expect.poll(() => focusedRole(page), { message: "Mod+K should focus the palette's combobox" }).toBe("combobox");
  const comboboxes = page.getByRole("combobox");
  for (let i = 0; i < (await comboboxes.count()); i += 1) {
    const candidate = comboboxes.nth(i);
    if (await candidate.evaluate((el) => el === document.activeElement)) {
      await expect(candidate).toBeFocused();
      return candidate;
    }
  }
  throw new Error("Mod+K focused a combobox that the accessibility tree doesn't list.");
}

async function activeOptionText(input: Locator): Promise<string | null> {
  return input.evaluate((el) => {
    const id = el.getAttribute("aria-activedescendant");
    const option = id ? document.getElementById(id) : null;
    return option?.textContent ?? null;
  });
}

/** `_support/keys.ts`'s `runInPalette`, using the page's own Mod key. */
export async function runInPalette(page: Page, query: string): Promise<void> {
  const input = await openPalette(page);
  await input.fill(query);
  await expect
    .poll(async () => (await activeOptionText(input))?.toLowerCase().includes(query.toLowerCase()) ?? false, {
      message: `the palette's active row should be "${query}"`,
    })
    .toBe(true);
  await page.keyboard.press("Enter");
}

/** `${mod}+s`, resolved for this page: ⌘S / Ctrl+S (Save). */
export async function pressSave(page: Page): Promise<void> {
  await page.keyboard.press(`${await mod(page)}+s`);
}

/** `${mod}+o`, resolved for this page: ⌘O / Ctrl+O (Open…). */
export async function pressOpen(page: Page): Promise<void> {
  await page.keyboard.press(`${await mod(page)}+o`);
}
