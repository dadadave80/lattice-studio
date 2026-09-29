/**
 * Deploying, on this test's Anvil node (spec L561-L574, Flow 12, L751-L761, L777-L778): axe in the deploy review and
 * after a refused deploy, in both themes and every emulation; focus around the review and the Safe batch; and what a
 * refused transaction leaves for a keyboard and screen reader user. Keyboard only once the page has loaded.
 *
 * The tests run one after another in one worker: each needs this worktree's one Anvil port, and the kit only waits
 * for a busy port when Anvil's error says "address already in use", which it doesn't always (see the Q2 report).
 */
import type { Page } from "@playwright/test";
import { expect, test } from "../_support/fixtures.ts";
import { focusRegion, region } from "../_support/keys.ts";
import { checkEveryEmulation } from "./support/axe-check.ts";
import {
  DEPLOY_FAILURE_LINE, deployReview, failDeploy, openDeployReview, readyToDeploy, refuseTransactions, tickAcknowledgements,
} from "./support/deploy.ts";
import { clickScrim, closeWithEscape, focusInside, originFocused, roundTrip } from "./support/dialogs.ts";
import { runInPalette, tabTo } from "./support/keyboard.ts";
import { withoutKnownGaps } from "./support/known-gaps.ts";
import { THEMES, expectTheme, seedTheme, type AppState } from "./support/states.ts";

test.describe.configure({ mode: "default", timeout: 180_000 });

/** The review and a refused deploy, scoped to the review (the page behind it is inert). */
const DEPLOY_STATES: readonly AppState[] = [
  {
    name: "deploy review",
    scope: deployReview,
    async reach(page) {
      await readyToDeploy(page);
      await openDeployReview(page);
    },
  },
  {
    name: "deploy error",
    scope: deployReview,
    async reach(page) {
      await readyToDeploy(page);
      const review = await openDeployReview(page);
      await tickAcknowledgements(page, review);
      await refuseTransactions(page);
      await failDeploy(page, review);
    },
  },
];

for (const state of DEPLOY_STATES) {
  test.describe(`axe · ${state.name}`, () => {
    for (const theme of THEMES) {
      test(`${theme} theme, every emulation`, async ({ page, context, anvil }) => {
        expect(anvil.url).toContain("127.0.0.1");
        await seedTheme(context, theme);
        await state.reach(page);
        await expectTheme(page, theme);
        await checkEveryEmulation(page, state);
      });
    }
  });
}

async function titleBarButton(page: Page, name: string): Promise<void> {
  await focusRegion(page, "Title bar");
  await tabTo(page, region(page, "Title bar").getByRole("button", { name, exact: true }));
}

test.describe("focus around deploying (spec L751-L761, WCAG 2.4.3)", () => {
  test("Deploy review, from the title block's Deploy…", async ({ page, anvil }) => {
    expect(anvil.url).toContain("127.0.0.1");
    await readyToDeploy(page);
    await focusRegion(page, "Sheet");
    await tabTo(page, region(page, "Sheet").getByRole("button", { name: "Deploy…" }));
    await roundTrip(page, () => page.keyboard.press("Enter"), deployReview(page));
  });

  test("Safe batch, through the palette, once the review's acknowledgements are ticked", async ({ page, anvil }) => {
    expect(anvil.url).toContain("127.0.0.1");
    await readyToDeploy(page);
    const review = await openDeployReview(page);
    await tickAcknowledgements(page, review);
    await closeWithEscape(page, review);
    await titleBarButton(page, "Share");
    await roundTrip(page, () => runInPalette(page, "Export Safe batch…"), page.getByRole("dialog", { name: /Safe batch/ }));
  });

  test("a refused transaction keeps focus in the review and is announced (WCAG 4.1.3)", async ({ page, anvil }) => {
    expect(anvil.url).toContain("127.0.0.1");
    await readyToDeploy(page);
    const review = await openDeployReview(page);
    await tickAcknowledgements(page, review);
    await refuseTransactions(page);
    await failDeploy(page, review);
    // Let the review settle after the refusal before judging where focus is and what was said.
    await page.waitForTimeout(1_000);
    const problems: string[] = [];
    if (!(await focusInside(review))) {
      problems.push(`refused send: focus is on ${await originFocused(page)}, outside the review (2.4.3)`);
    }
    const line = (await page.getByRole("log").getByRole("button", { name: DEPLOY_FAILURE_LINE }).last().textContent()) ?? "";
    const text = line.replace(/^(Deploy|Error)/, "").trim();
    const said = await page.evaluate(() =>
      [...document.querySelectorAll('[role="status"], [role="alert"]')].map((el) => el.textContent ?? "").join(" "),
    );
    if (!said.includes(text)) problems.push(`refused send: "${text}" is logged but not announced (4.1.3)`);
    const unknown = withoutKnownGaps(problems, test.info());
    expect(unknown, unknown.join("\n")).toEqual([]);
  });
});

test.describe("a scrim click leaves the Deploy review open (IR L188)", () => {
  test("the review holds acknowledgements and a simulation, so the scrim doesn't close it", async ({ page, anvil }) => {
    expect(anvil.url).toContain("127.0.0.1");
    await readyToDeploy(page);
    const review = await openDeployReview(page);
    await clickScrim(page, review);
    // Closing runs on the press itself; give it the time an exit animation would take before judging.
    await page.waitForTimeout(400);
    await expect(review).toBeVisible();
  });
});
