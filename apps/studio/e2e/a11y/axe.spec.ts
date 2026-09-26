/**
 * The automated floor of WCAG 2.2 AA (spec L795-L797): axe with the `wcag2a` to `wcag22aa` tags and `target-size`
 * on, in every state the brief lists, in both themes, each under no preference, forced colors, reduced motion and
 * more contrast. axe misses most criteria, so a clean run is only the floor; `keyboard.spec.ts`, `focus.spec.ts`,
 * `deploy.spec.ts` (the deploy review and deploy error states, on Anvil) and MANUAL.md cover the rest. Findings a
 * filed gap explains are annotated (`known-gaps.ts`); any other fails.
 */
import { test } from "../_support/fixtures.ts";
import { checkEveryEmulation } from "./support/axe-check.ts";
import { DIALOG_STATES, STATES, THEMES, expectTheme, seedTheme } from "./support/states.ts";

for (const state of [...STATES, ...DIALOG_STATES]) {
  test.describe(`axe · ${state.name}`, () => {
    for (const theme of THEMES) {
      test(`${theme} theme, every emulation`, async ({ page, context }) => {
        await seedTheme(context, theme);
        await state.reach(page);
        await expectTheme(page, theme);
        await checkEveryEmulation(page, state);
      });
    }
  });
}
