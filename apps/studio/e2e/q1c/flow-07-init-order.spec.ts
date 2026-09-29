/**
 * Flow 7, step 5: order, for step inits only (spec L457-L470, IR "Init plan" and "I"). The cases Q1c couldn't run
 * because no v1 template gives two movable steps: `seeds.ts`'s Blank diamond + ERC20Init does.
 *
 * The plan reads AccessControlInit, ERC20Init, then the automatic ERC-165 step (locked, never moved). Nothing in
 * the overlay orders those two against each other, so every move is legal and none raises INIT-02.
 *
 * The console line is the spec's own (L717, "Moved VaultCore to step 3, after ERC4626."): `Moved {step} to step
 * {n}` and, when a step now sits above it, `, after {that step}`.
 */
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../_support/fixtures.ts";
import { focusRegion, modifierKey } from "../_support/keys.ts";
import { seedProject } from "../_support/seed.ts";
import { consoleLog, waitForConsoleReady } from "./pages/console-page.ts";
import { expectInitPlanOpen, InitPlanPage } from "./pages/init-plan-page.ts";
import { runInPalette } from "./pages/palette-page.ts";
import { SheetPage } from "./pages/sheet-page.ts";
import { TitleBarPage } from "./pages/title-bar-page.ts";
import { SEEDED_STEPS, twoStepProject } from "./seeds.ts";

const AUTOMATIC = "Register ERC-165 interfaces (automatic)";
const CHIP = "Init order · Esc";

/** The plan's step titles in the order the list shows them (h3 per step, spec L467). */
async function order(plan: InitPlanPage): Promise<string[]> {
  return plan.root.getByRole("list", { name: "Steps in call order" }).getByRole("heading", { level: 3 }).allTextContents();
}

/** The legend's steps in the order the dashed path visits them (the sheet's side of the same order). */
async function legend(page: Page): Promise<string[]> {
  return page.locator('[data-chrome="init-legend"] li').allTextContents();
}

/** Seeds the two-step diamond and turns init order mode on with `I`, the way Flow 7 step 5 says. */
async function enterInitOrder(page: Page): Promise<{ plan: InitPlanPage; sheet: SheetPage }> {
  await seedProject(page, { project: twoStepProject() });
  const sheet = new SheetPage(page);
  // The sheet has to be up before its single keys are (the cards and the tool strip mount with it).
  await expect(sheet.card("ERC20")).toBeVisible();
  await expect(sheet.toolStrip).toBeVisible();
  await focusRegion(page, "Sheet");
  await page.keyboard.press("i");
  await expect(page.getByRole("button", { name: CHIP })).toBeVisible();
  const plan = await expectInitPlanOpen(page);
  return { plan, sheet };
}

function badgeOn(sheet: SheetPage, card: string): Locator {
  return sheet.card(card).locator("[data-init-step]");
}

test("I turns init order mode on: badges in step order, the legend, and both movable steps' controls @smoke", async ({ page }) => {
  const { plan, sheet } = await enterInitOrder(page);

  expect(await order(plan)).toEqual([...SEEDED_STEPS, AUTOMATIC]);
  expect(await legend(page)).toEqual(["01AccessControlInit", "02ERC20Init", `03${AUTOMATIC}`]);
  await expect(badgeOn(sheet, "AccessControl")).toHaveAttribute("data-init-step", "1");
  await expect(badgeOn(sheet, "ERC20")).toHaveAttribute("data-init-step", "2");
  // 2 movable steps: the legend offers the drag and the plan offers Reorder steps automatically (spec L467).
  await expect(page.getByText("Drag a badge to reorder")).toBeVisible();
  await expect(plan.reorderAuto).toBeVisible();
  // Each edge says why it won't move; the middle moves both ways.
  await expect(plan.moveStepButton("AccessControlInit", "up")).toHaveAttribute("aria-disabled", "true");
  await expect(plan.moveStepButton("AccessControlInit", "down")).not.toHaveAttribute("aria-disabled", "true");
  await expect(plan.moveStepButton("ERC20Init", "up")).not.toHaveAttribute("aria-disabled", "true");
  await expect(plan.moveStepButton("ERC20Init", "down")).toHaveAttribute("aria-disabled", "true");

  // Esc leaves the mode.
  await focusRegion(page, "Sheet");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: CHIP })).toHaveCount(0);
});

test("Alt+↑ and Alt+↓ move a step, each one console line and one undo step (keyboard only)", async ({ page }) => {
  const { plan, sheet } = await enterInitOrder(page);
  await waitForConsoleReady(page);
  const log = consoleLog(page);
  const mod = await modifierKey(page);

  // Alt+↑ on ERC20Init (focus on its heading, IR L97: it comes up from the step's controls and heading).
  await plan.stepHeading("ERC20Init").focus();
  await page.keyboard.press("Alt+ArrowUp");
  await expect.poll(() => order(plan)).toEqual(["ERC20Init", "AccessControlInit", AUTOMATIC]);
  await expect(log).toContainText("Moved ERC20Init to step 1.");
  // The sheet follows: the badges swap and the legend lists the new order.
  await expect(badgeOn(sheet, "ERC20")).toHaveAttribute("data-init-step", "1");
  await expect(badgeOn(sheet, "AccessControl")).toHaveAttribute("data-init-step", "2");
  expect(await legend(page)).toEqual(["01ERC20Init", "02AccessControlInit", `03${AUTOMATIC}`]);

  // Alt+↓ on the same step puts it back, and names the step it now follows.
  await plan.stepHeading("ERC20Init").focus();
  await page.keyboard.press("Alt+ArrowDown");
  await expect.poll(() => order(plan)).toEqual([...SEEDED_STEPS, AUTOMATIC]);
  await expect(log).toContainText("Moved ERC20Init to step 2, after AccessControlInit.");
  await expect(badgeOn(sheet, "AccessControl")).toHaveAttribute("data-init-step", "1");

  // Alt+↑ again, then undo: one press is one undo step, and Undo restores the order the press changed.
  await plan.stepHeading("ERC20Init").focus();
  await page.keyboard.press("Alt+ArrowUp");
  await expect.poll(() => order(plan)).toEqual(["ERC20Init", "AccessControlInit", AUTOMATIC]);
  await focusRegion(page, "Sheet");
  await page.keyboard.press(`${mod}+z`);
  await expect.poll(() => order(plan)).toEqual([...SEEDED_STEPS, AUTOMATIC]);
  await expect(log).toContainText("Undid: Moved ERC20Init to step 1.");
  // Redo brings the move back.
  await page.keyboard.press(`${mod}+Shift+z`);
  await expect.poll(() => order(plan)).toEqual(["ERC20Init", "AccessControlInit", AUTOMATIC]);
});

test("Alt+↑ at the top and Alt+↓ at the bottom of the movable steps change nothing, and say so", async ({ page }) => {
  const { plan } = await enterInitOrder(page);
  await waitForConsoleReady(page);
  const undo = await new TitleBarPage(page).undoControl();
  await plan.stepHeading("AccessControlInit").focus();
  await page.keyboard.press("Alt+ArrowUp");
  await expect(consoleLog(page)).toContainText("There's no step 0 to move to: the plan has 2 steps.");
  await plan.stepHeading("ERC20Init").focus();
  await page.keyboard.press("Alt+ArrowDown");
  await expect(consoleLog(page)).toContainText("There's no step 3 to move to: the plan has 2 steps.");
  expect(await order(plan)).toEqual([...SEEDED_STEPS, AUTOMATIC]);
  // Nothing was edited, so there is nothing to undo.
  await expect(undo).toHaveAttribute("aria-disabled", "true");
});

test("Alt+↓ on a step in the Structure tree moves it too", async ({ page }) => {
  const { plan } = await enterInitOrder(page);
  await waitForConsoleReady(page);
  await runInPalette(page, "Show Structure");
  const item = page.getByRole("treeitem", { name: /^Step 1, AccessControlInit, / });
  await expect(item).toBeVisible();
  await item.focus();
  await page.keyboard.press("Alt+ArrowDown");
  await expect.poll(() => order(plan)).toEqual(["ERC20Init", "AccessControlInit", AUTOMATIC]);
  await expect(consoleLog(page)).toContainText("Moved AccessControlInit to step 2, after ERC20Init.");
});

test("the ↑/↓ buttons and the palette's Reorder steps automatically move steps too, each narrated", async ({ page }) => {
  const { plan } = await enterInitOrder(page);
  await waitForConsoleReady(page);
  const log = consoleLog(page);

  await plan.moveStepButton("AccessControlInit", "down").click();
  await expect.poll(() => order(plan)).toEqual(["ERC20Init", "AccessControlInit", AUTOMATIC]);
  await expect(log).toContainText("Moved AccessControlInit to step 2, after ERC20Init.");

  await plan.moveStepButton("AccessControlInit", "up").click();
  await expect.poll(() => order(plan)).toEqual([...SEEDED_STEPS, AUTOMATIC]);
  await expect(log).toContainText("Moved AccessControlInit to step 1.");

  await plan.moveStepButton("ERC20Init", "up").click();
  await expect.poll(() => order(plan)).toEqual(["ERC20Init", "AccessControlInit", AUTOMATIC]);
  await runInPalette(page, "Reorder steps automatically");
  // The overlay puts no order on these two, and the sort is stable: what it's given comes back unchanged, and
  // the command says why it did nothing.
  await expect(log).toContainText("The init steps are already in order.");
  expect(await order(plan)).toEqual(["ERC20Init", "AccessControlInit", AUTOMATIC]);
});
