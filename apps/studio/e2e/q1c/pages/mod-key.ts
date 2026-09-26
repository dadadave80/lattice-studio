/**
 * `_support/keys.ts` exports `MOD = "ControlOrMeta"` for `page.keyboard.press` chords, but on this Playwright
 * build (1.63.0, Chromium) `press("ControlOrMeta+k")` dispatches nothing at all, while `press("Control+k")`
 * and, on the Safari smoke project, `press("Meta+k")` both work (confirmed with a throwaway spec pressing each
 * directly against ⌘K and checking whether the palette's combobox appeared). This resolves the platform's real
 * modifier name for every chord this suite presses directly, instead of the broken alias; see the WP-Q1c
 * report's Follow-ups for the kit-level fix this points to.
 */
import type { Page } from "@playwright/test";
import { pagePlatform } from "../../_support/keys.ts";

/** "Control+z" (or "Meta+z" on the Safari smoke project): the chord `page.keyboard.press` actually fires. */
export async function modChord(page: Page, key: string): Promise<string> {
  return `${(await pagePlatform(page)) === "mac" ? "Meta" : "Control"}+${key}`;
}

/** Presses a ⌘/Ctrl chord, e.g. `pressMod(page, "z")` or `pressMod(page, "Shift+z")`. */
export async function pressMod(page: Page, key: string): Promise<void> {
  await page.keyboard.press(await modChord(page, key));
}
