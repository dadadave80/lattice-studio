/**
 * Narrow layouts (spec L353-L370). The frozen Playwright config has two projects (Chromium and the WebKit smoke
 * set), so the narrow "projects" are viewport presets a suite applies to a `describe` block:
 *
 *   for (const width of NARROW_WIDTHS) {
 *     test.describe(`at ${width} px`, () => {
 *       test.use({ viewport: viewportAt(width) });
 *       test("…", async ({ page }) => { … });
 *     });
 *   }
 *
 * Each width names the tier the shell draws there (`data-layout` on the shell root, S3).
 */
import { expect, type Page } from "@playwright/test";

/** The shell's layout tiers (S3's `layout-tier.ts`). */
export type LayoutTier = "wide" | "mid" | "narrow" | "phone";

/** The widths the spec's narrow variants run at, and the default desktop width. */
export const VIEWPORTS = {
  1440: { width: 1440, height: 900, tier: "wide" },
  768: { width: 768, height: 1024, tier: "narrow" },
  375: { width: 375, height: 812, tier: "phone" },
} as const satisfies Record<number, { width: number; height: number; tier: LayoutTier }>;

export type ViewportWidth = keyof typeof VIEWPORTS;

/** The narrow widths every flow that moves controls runs at too (brief Q0, spec L938). */
export const NARROW_WIDTHS = [768, 375] as const satisfies readonly ViewportWidth[];

/** The `viewport` option for `test.use`. */
export function viewportAt(width: ViewportWidth): { width: number; height: number } {
  const { width: w, height } = VIEWPORTS[width];
  return { width: w, height };
}

/** The tier the shell should draw at `width`. */
export function tierAt(width: ViewportWidth): LayoutTier {
  return VIEWPORTS[width].tier;
}

/** Waits until the shell root draws `tier` (its `data-layout` attribute, S3's stable hook). */
export async function expectTier(page: Page, tier: LayoutTier): Promise<void> {
  await expect(page.locator("[data-layout]").first()).toHaveAttribute("data-layout", tier);
}
