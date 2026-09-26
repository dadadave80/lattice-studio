/**
 * Gets the console onto the screen at every layout tier, then runs a line through it with `_support/keys.ts`'s
 * `runConsole` (FX26 fixed its Tab-hunt to wait for the console's lazy body and walk by region order instead of
 * a fixed count, so this file no longer needs its own workaround for that part).
 */
import type { Locator, Page } from "@playwright/test";
import { runConsole } from "../../_support/keys.ts";

/**
 * Gets the Console onto the screen wherever the layout tier hides it:
 * - Below 768 px (the phone tier), the pane switcher shows one region at a time as tabs (IR "Layout controls");
 *   the Console region isn't rendered until its tab is selected.
 * - At the narrow and mid tiers (768-1279 px) the drawer starts collapsed to its summary line
 *   (`layout-tier.ts`); its "Expand console" toggle opens it.
 * Keyboard only throughout: a tab or a toggle takes focus and Enter (or, for an APG tab, an arrow key)
 * activates it, exactly what a person tabbing there would do, so this never turns a keyboard-only spec into a
 * pointer one.
 */
export async function waitForConsoleReady(page: Page): Promise<void> {
  const paneTab = page.getByRole("tab", { name: "Console" });
  if (await paneTab.count()) {
    await paneTab.focus();
    if ((await paneTab.getAttribute("aria-selected")) !== "true") await page.keyboard.press("Enter");
  }
  const toggle = page.getByRole("button", { name: "Expand console" });
  if (await toggle.count()) {
    await toggle.focus();
    await page.keyboard.press("Enter");
  }
  await page.getByRole("log", { name: "Log" }).waitFor({ state: "attached" });
}

/** Types one console line and presses Enter, keyboard only, at any layout tier. */
export async function runConsoleCommand(page: Page, line: string): Promise<void> {
  await waitForConsoleReady(page);
  await runConsole(page, line);
}

/** The Log (IR "Console drawer": `role=log`), where console lines and the command's echo appear. */
export function consoleLog(page: Page): Locator {
  return page.getByRole("log", { name: "Log" });
}
