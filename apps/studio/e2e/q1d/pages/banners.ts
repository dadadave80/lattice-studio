/**
 * S10's banner host (IR L199-L210): one line of text, an icon named by its tone, and its actions as the
 * commands' own titles ("Take over editing", "Migrate to 0.4.1…", "Confirm addresses…"). No board yet
 * (PA L72-L84), so a banner is found by its exact text, spec-quoted, not by a region role the design doesn't
 * give it yet.
 */
import { expect, type Locator, type Page } from "@playwright/test";
import { ELSEWHERE, HANDED_OVER, sharedLinkBanner, UNBUNDLED } from "../../../src/flows/copy.ts";

export { ELSEWHERE, HANDED_OVER, sharedLinkBanner, UNBUNDLED };

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A banner by its exact text (spec-quoted): `<p>` tags only. Every disabled command whose reason is the same
 * read-only reason (any facet button, the project name, …) carries a hidden span with the identical text for
 * its own tooltip and description, so a plain `getByText` finds dozens of matches; `Banner.tsx` renders its
 * text in a `<p>`, which none of those hidden reason spans are.
 */
export function banner(page: Page, text: string): Locator {
  return page.locator("p").filter({ hasText: new RegExp(`^${escapeRegExp(text)}$`) });
}

/** Waits for the banner with `text` to show, then returns its action button by the command's title. */
export async function bannerAction(page: Page, text: string, actionTitle: string): Promise<Locator> {
  await expect(banner(page, text)).toBeVisible();
  return page.getByRole("button", { name: actionTitle });
}
