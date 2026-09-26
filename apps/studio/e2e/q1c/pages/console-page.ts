/**
 * A keyboard-only way to reach the console's command line that stays reliable as the Log fills up.
 *
 * `_support/keys.ts`'s `runConsole` hunts for the command line with at most 20 Tab presses from the Console
 * region. Each log line is its own Tab stop (IR "Log": clicking one selects and locates its facet), and a
 * freshly opened project already logs one ("Catalog: Lattice … · v1 targets …", spec's catalog provisional
 * note), so the command line sits at the 21st stop before this suite has placed anything and further out with
 * every line after that. This file raises the budget instead of asking Q0 to (out of Q1c's scope); see the
 * Follow-ups in the WP-Q1c report.
 */
import { expect, type Locator, type Page } from "@playwright/test";
import { commandLine, focusRegion } from "../../_support/keys.ts";

const MAX_TAB_HOPS = 100;

/**
 * Gets the Console onto the screen wherever the layout tier hides it, then waits for its lazy chunk (the Log
 * and the command line) to mount:
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

async function isCommandLineFocused(page: Page): Promise<boolean> {
  const input = commandLine(page);
  return (await input.count()) === 1 && (await input.evaluate((el) => el === document.activeElement));
}

/** Focuses the command line, keyboard only: F6 to the Console region, then Tab until it takes focus. */
export async function focusCommandLine(page: Page): Promise<Locator> {
  const input = commandLine(page);
  if (await isCommandLineFocused(page)) return input;
  await waitForConsoleReady(page);
  await focusRegion(page, "Console");
  for (let presses = 0; presses < MAX_TAB_HOPS && !(await isCommandLineFocused(page)); presses += 1) {
    await page.keyboard.press("Tab");
  }
  await expect(input).toBeFocused();
  return input;
}

/** Types one console line and presses Enter, keyboard only (IR "Console drawer": the "›" prompt echoes it). */
export async function runConsoleCommand(page: Page, line: string): Promise<void> {
  await focusCommandLine(page);
  await page.keyboard.type(line);
  await page.keyboard.press("Enter");
}

/** The Log (IR "Console drawer": `role=log`), where console lines and the command's echo appear. */
export function consoleLog(page: Page): Locator {
  return page.getByRole("log", { name: "Log" });
}
