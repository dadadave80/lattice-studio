/**
 * Work packages that haven't landed yet show "Not built yet · WP-<id>": as a placeholder panel, as the hidden
 * reason of a disabled control (`aria-describedby`), or as an announcement when a placeholder command runs from a
 * key. A spec that needs one of them skips with that reason instead of failing, and runs as soon as it lands.
 * Never skip silently: the reason names the work package.
 */
import { test, type Page } from "@playwright/test";

/** "Not built yet · WP-S6". */
export function notBuiltText(wp: string): string {
  return `Not built yet · WP-${wp}`;
}

/** Whether the page shows or announces `wp`'s placeholder anywhere (hidden reasons and live regions included). */
export async function showsNotBuilt(page: Page, wp: string): Promise<boolean> {
  return page.evaluate((text) => document.body.textContent?.includes(text) ?? false, notBuiltText(wp));
}

/** Skips the running test while any of `wps` still shows its placeholder. */
export async function skipUnlessBuilt(page: Page, ...wps: string[]): Promise<void> {
  for (const wp of wps) test.skip(await showsNotBuilt(page, wp), notBuiltText(wp));
}
