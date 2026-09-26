/**
 * A thin wrapper around `_support/keys.ts` for `Mod`-key presses this WP needs beyond what it exports
 * (`pressSave`, `pressOpen`).
 *
 * Earlier in this WP, `_support/keys.ts`'s `MOD` constant ("ControlOrMeta") resolved on the *host* OS running
 * Playwright, not on the page's detected platform: under the `chromium` project (Desktop Chrome), the page's
 * `navigator.userAgentData.platform` reports a non-mac platform even on a macOS host, so Studio's own
 * `detectPlatform` (`src/ui/shared/platform.ts`) lands on `"other"` and binds `Mod` to Ctrl there, while a
 * macOS host's Playwright sent Meta regardless — every `Mod` shortcut run through the old `MOD` constant was
 * dead in `chromium` on a macOS host. WP-FX26 fixed this on `dev` (`modifierKey`/`pagePlatform`-based
 * `openPalette` and `runInPalette`, plus a `runConsole` that waits for the console body to mount); this file
 * now just re-exports those and adds the two presses this WP needed that the kit doesn't cover.
 */
import type { Page } from "@playwright/test";
import { modifierKey } from "../../_support/keys.ts";

export { modifierKey as mod, openPalette, runInPalette } from "../../_support/keys.ts";

/** `${Mod}+s`, resolved for this page: ⌘S / Ctrl+S (Save). */
export async function pressSave(page: Page): Promise<void> {
  await page.keyboard.press(`${await modifierKey(page)}+s`);
}

/** `${Mod}+o`, resolved for this page: ⌘O / Ctrl+O (Open…). */
export async function pressOpen(page: Page): Promise<void> {
  await page.keyboard.press(`${await modifierKey(page)}+o`);
}
