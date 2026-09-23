/**
 * Narrow viewports: each preset lands the shell in the tier the spec gives that width (spec L353-L370).
 */
import { expect, test } from "../fixtures.ts";
import { region } from "../keys.ts";
import { openEmpty } from "../seed.ts";
import { NARROW_WIDTHS, expectTier, tierAt, viewportAt, type ViewportWidth } from "../viewports.ts";

const WIDTHS: readonly ViewportWidth[] = [1440, ...NARROW_WIDTHS];

for (const width of WIDTHS) {
  test.describe(`at ${width} px @smoke`, () => {
    test.use({ viewport: viewportAt(width) });

    test(`draws the ${tierAt(width)} layout`, async ({ page }) => {
      await openEmpty(page);
      await expectTier(page, tierAt(width));
      await expect(region(page, "Title bar")).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, "no horizontal page scroll").toBeLessThanOrEqual(0);
    });
  });
}
