/**
 * Flow 10 step 8, "Two tabs" (spec L505, IR L204-L205): the second tab on a project opens read-only with
 * Take over editing; the first flushes its pending save, hands over and shows Editing moved to another tab
 * with Take back editing. Edits reach the other tab through BroadcastChannel. A deploy record still writes
 * from the demoted tab, because deployment records sit outside the lock (`persist/current.ts`: "Records
 * never wait for the edit lock.") — proved here with Retry verification (`deploy.retryVerification`), whose
 * `enabled` ignores the session's read-only reason, rather than a full Sign & deploy (out of this spec's
 * scope; Flow 12 belongs to the deploy-review suites).
 *
 * Both tabs are pages in the same browser context (`page.context().newPage()`), so they share IndexedDB, Web
 * Locks and BroadcastChannel exactly as two tabs of one browser would.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "../_support/fixtures.ts";
import { recipeProject } from "../_support/projects.ts";
import { expectProject, seedProject } from "../_support/seed.ts";
import { banner, ELSEWHERE, HANDED_OVER } from "./pages/banners.ts";
import { expectLogLine, log } from "./pages/console.ts";
import { failedVerificationRecord, UNVERIFIABLE_REASON } from "./pages/deployments.ts";
import { deploymentRow, showDeployments } from "./pages/inspector.ts";
import { runInPalette } from "./pages/keys.ts";
import { expectSaveStatus, titleBar } from "./pages/shell.ts";

const PROJECT_NAME = "TwoTabVault";

function projectNameButton(page: Page, name: string) {
  return titleBar(page).getByRole("button", { name });
}

/** Take over editing / Take back editing: the same command, its title flips with the lock state (IR L204-L205). */
function takeOverButton(page: Page) {
  return page.getByRole("button", { name: /^(Take over editing|Take back editing)$/ });
}

test.describe("Flow 10 step 8: two tabs (spec L505)", () => {
  test("the second tab opens read-only with Take over editing; the first hands over and offers Take back editing", async ({ page }) => {
    const project = recipeProject("GovernedVault", { name: PROJECT_NAME });
    await seedProject(page, { project });
    await expectSaveStatus(page, "Saved");

    const tab2 = await page.context().newPage();
    await tab2.goto("/");
    await expectProject(tab2, PROJECT_NAME);

    // Tab 2: read-only, with the banner and its way out (IR L204).
    await expect(banner(tab2, ELSEWHERE)).toBeVisible();
    await expectSaveStatus(tab2, "Read-only");
    await expect(projectNameButton(tab2, PROJECT_NAME)).toHaveAccessibleDescription(ELSEWHERE);

    // Take over editing (pointer): tab 2 becomes the editor.
    await takeOverButton(tab2).click();
    await expect(banner(tab2, ELSEWHERE)).toHaveCount(0);
    await expectSaveStatus(tab2, "Saved");
    await expect(projectNameButton(tab2, PROJECT_NAME)).not.toHaveAttribute("aria-disabled", "true");

    // Tab 1: demoted (IR L205).
    await expect(banner(page, HANDED_OVER)).toBeVisible();
    await expectSaveStatus(page, "Read-only");
    await expect(projectNameButton(page, PROJECT_NAME)).toHaveAccessibleDescription(HANDED_OVER);

    // Take back editing (pointer): tab 1 is the editor again. Tab 2 now shows "Editing moved to another
    // tab" too (it's the one that just handed over), with its own way back (IR L205: the same command,
    // "Take over editing" or "Take back editing", per which side of the handover a tab is on).
    await takeOverButton(page).click();
    await expect(banner(page, HANDED_OVER)).toHaveCount(0);
    await expectSaveStatus(page, "Saved");
    await expect(banner(tab2, HANDED_OVER)).toBeVisible();
    await expectSaveStatus(tab2, "Read-only");

    await tab2.close();
  });

  test("keyboard-only: Take over editing and Take back editing run from the palette", async ({ page }) => {
    const project = recipeProject("GovernedVault", { name: PROJECT_NAME });
    await seedProject(page, { project });

    const tab2 = await page.context().newPage();
    await tab2.goto("/");
    await expectProject(tab2, PROJECT_NAME);
    await expect(banner(tab2, ELSEWHERE)).toBeVisible();

    // Brings the tab to the front before typing into it, as a person switching tabs would.
    await tab2.bringToFront();
    await runInPalette(tab2, "Take over editing");
    await expect(banner(tab2, ELSEWHERE)).toHaveCount(0);
    await expect(banner(page, HANDED_OVER)).toBeVisible();

    await page.bringToFront();
    await runInPalette(page, "Take back editing");
    await expect(banner(page, HANDED_OVER)).toHaveCount(0);
    await expect(banner(tab2, HANDED_OVER)).toBeVisible();

    await tab2.close();
  });

  test("edits reach the other tab through BroadcastChannel", async ({ page }) => {
    const project = recipeProject("GovernedVault", { name: PROJECT_NAME });
    await seedProject(page, { project });

    const tab2 = await page.context().newPage();
    await tab2.goto("/");
    await expectProject(tab2, PROJECT_NAME);

    // Tab 1 holds the lock and renames in place (IR L65): click, type, Enter commits.
    const RENAMED = "TwoTabVault Renamed";
    await projectNameButton(page, PROJECT_NAME).click();
    const input = titleBar(page).getByRole("textbox", { name: "Project name" });
    await input.fill(RENAMED);
    await input.press("Enter");
    await expectProject(page, RENAMED);

    // Tab 2 (read-only) sees the rename without a reload: the "change" broadcast loads it quietly.
    await expectProject(tab2, RENAMED);

    await tab2.close();
  });

  test("a deployment record still writes from the demoted tab (deployment records sit outside the lock)", async ({ page }) => {
    const project = recipeProject("GovernedVault", { name: PROJECT_NAME });
    const record = failedVerificationRecord(project);
    await seedProject(page, { project, deployments: [record] });

    const tab2 = await page.context().newPage();
    await tab2.goto("/");
    await expectProject(tab2, PROJECT_NAME);

    // Tab 2 takes over; tab 1 is demoted (read-only) but keeps the project open.
    await takeOverButton(tab2).click();
    await expect(banner(page, HANDED_OVER)).toBeVisible();
    await expectSaveStatus(page, "Read-only");

    // A document edit is refused in the demoted tab (contrast): the project name button says why.
    await expect(projectNameButton(page, PROJECT_NAME)).toHaveAccessibleDescription(HANDED_OVER);

    // But a deployment record still writes there: Retry verification (`enabled: () => ({ ok: true })`, no
    // read-only gate) resolves at once (chain 31337: Sourcify is never called, `chains.ts`'s `sourcifyServes`).
    await page.bringToFront();
    await showDeployments(page);
    const row = deploymentRow(page, record.chainId, record.address);
    await expect(row).toBeVisible();
    const before = await log(page).getByText(`Couldn't verify: ${UNVERIFIABLE_REASON}`).count();
    await row.getByRole("button", { name: "Retry verification" }).click();
    await expect
      .poll(async () => log(page).getByText(`Couldn't verify: ${UNVERIFIABLE_REASON}`).count())
      .toBeGreaterThan(before);
    await expectLogLine(page, `Couldn't verify: ${UNVERIFIABLE_REASON}`);

    await tab2.close();
  });
});
