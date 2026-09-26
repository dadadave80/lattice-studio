/**
 * The automated floor of WCAG 2.2 AA (spec L795-L797): axe with the `wcag2a` to `wcag22aa` tags and `target-size`
 * on, in every state the brief lists, in both themes, each under no preference, forced colors, reduced motion and
 * more contrast. axe misses most criteria, so a clean run is only the floor; `keyboard.spec.ts`, `focus.spec.ts`
 * and MANUAL.md cover the rest. Findings a filed gap explains are annotated (`known-gaps.ts`); any other fails.
 */
import { runAxe } from "../_support/axe.ts";
import { expect, test } from "../_support/fixtures.ts";
import { DEPLOY_REVIEW_CRASH, withoutKnownGaps } from "./support/known-gaps.ts";
import { findings } from "./support/report.ts";
import { EMULATIONS, STATES, THEMES, expectTheme, seedTheme } from "./support/states.ts";

for (const state of STATES) {
  test.describe(`axe · ${state.name}`, () => {
    for (const theme of THEMES) {
      test(`${theme} theme, every emulation`, async ({ page, context }) => {
        await seedTheme(context, theme);
        await state.reach(page);
        await expectTheme(page, theme);
        const found: string[] = [];
        for (const emulation of EMULATIONS) {
          await page.emulateMedia(emulation.media);
          const results = await runAxe(page, emulation.disable ? { disable: emulation.disable } : {});
          for (const line of findings(results)) found.push(`${emulation.name}: ${line}`);
        }
        const unknown = withoutKnownGaps(found, test.info());
        expect(unknown, unknown.join("\n")).toEqual([]);
      });
    }
  });
}

// Deploy review (spec L561-L573) and a failed deploy shown in it (Flow 12) are states the brief lists; they can't be
// reached until the review renders.
for (const name of ["deploy review", "deploy error"] as const) {
  test.describe(`axe · ${name}`, () => {
    for (const theme of THEMES) {
      test(`${theme} theme, every emulation`, () => {
        test.fixme(true, DEPLOY_REVIEW_CRASH);
      });
    }
  });
}
