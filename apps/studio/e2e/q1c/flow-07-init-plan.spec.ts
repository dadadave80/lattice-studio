/**
 * Flow 7. Set init parameters and order (spec L457-L469).
 *
 * 1. Open the plan from Fill in, the Init section of a facet, Init plan in the Structure tree, the palette, or I.
 * 2. The inspector shows the plan: a bundle (GovernedVaultInit) is one locked step with one form (nine fields);
 *    step inits (MultiInit) list one step per init contract.
 * 3. Field types: address (checksum, quick picks), duration (number + unit, echoed "= 5 minutes" — see this
 *    file's `MIN_DELAY_EXAMPLE_ECHO` comment for the one case that doesn't match the spec's phrasing literally),
 *    percent, token amount, string, boolean, enum.
 * 4. Every field has a label, help text, a dot ("example"/"set by you"); commits on Enter or blur, Esc reverts,
 *    errors show inline and in Problems (INIT-01).
 * 5. Order, for step inits only: ↑/↓, drag a badge, or Reorder steps automatically; a bundle's order is fixed.
 * 6. The ERC-165 step is appended automatically and shown locked: "Register ERC-165 interfaces (automatic)".
 * 7. An Authority table under the plan updates live: who holds admin, upgrade, guardian, proposer and executor
 *    roles, with full addresses. Changing who can upgrade goes through Flow 17 (a different helper's WP).
 *
 * Seeds and what they give this file (confirmed by reading the overlay and running `planInit`/`authorityTable`
 * against the built catalog directly, not guessed):
 * - `recipeProject("GovernedVault")` (unfilled): a bundle plan, one locked step, `bundle.p.asset` missing
 *   (INIT-01: "Asset is required. Fill it in before deploying."), the other eight fields holding their overlay
 *   examples ("Min delay" = 300 s). `{ filled: true }` clears the blocker
 *   for the Authority-table test, which doesn't depend on which fields are filled anyway (the vault's roles are
 *   all self-held or role-free, `authorityTable` returns the same five rows either way).
 * - `recipeProject("ERC20", { filled: true })`: a step plan with exactly two steps, `ERC20Init` (editable) and
 *   `DiamondIntrospectionInit.initImmutable` (`automatic: "initImmutable"`, locked) — the automatic ERC-165 step
 *   this file's step-3 test needs. `SafeDiamondCut`'s own init registers the flags itself (spec L468) and has no
 *   automatic step at all; neither recipe has 2+ *movable* steps (ERC20's only movable step is ERC20Init itself),
 *   so "Reorder steps automatically" (needs 2+) and an actual ↑/↓ or Alt+↑/↓ move have nowhere to run — see the
 *   Follow-ups in the WP-Q1c report. ERC20Init's own ↑/↓ buttons *do* render (`movable` is 1, not null, and the
 *   step isn't locked), both disabled at the list's one edge, which this file does check.
 */
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../_support/fixtures.ts";
import { recipeProject } from "../_support/projects.ts";
import { seedProject } from "../_support/seed.ts";
import { NARROW_WIDTHS, viewportAt } from "../_support/viewports.ts";
import { expectInitPlanOpen, InitPlanPage } from "./pages/init-plan-page.ts";
import { runInPalette } from "./pages/palette-page.ts";

const ASSET_MISSING = "Asset is required. Fill it in before deploying.";
// `fillMissingArgs` (the same helper `recipeProject({ filled: true })` uses) fills `bundle.p.asset` with this
// literal address; it clears INIT-01 offline (the rule's `code(token)` half is a chain check, skipped with no
// chain connected, contracts §4). Confirmed with a throwaway `analyze()` run against the built catalog.
const ASSET_EXAMPLE_ADDRESS = "0x71C7656EC7ab88b098defB751B7401B5f6d8976F";
// `duration.ts`'s `durationEcho`: while the shown unit already reads the value's best form ("5" minutes, the
// picker's default), the echo gives the raw stored seconds instead — the amount already says "5 minutes" once;
// the word form ("= 5 minutes", spec L463's own example) only shows once a *different* unit is picked, so the
// stored value gets a second, plain-English line. Confirmed against a real run's accessibility snapshot, not guessed.
const MIN_DELAY_EXAMPLE_ECHO = "= 300 s"; // 300 s, GovernedVaultInit's overlay example (`minDelay`).
const VOTING_DELAY_EXAMPLE_ECHO = "= 60 s"; // 60 s, GovernedVaultInit's overlay example (`votingDelay`).
const AUTOMATIC_ERC165_TITLE = "Register ERC-165 interfaces (automatic)"; // StepCard.tsx's AUTOMATIC_STEP_TITLE.

/** Opens the Init plan the way Flow 7 step 1 names the palette entry (`init.open`'s title, `commands.ts`). */
async function openInitPlanViaPalette(page: Page): Promise<InitPlanPage> {
  await runInPalette(page, "Open init plan");
  return expectInitPlanOpen(page);
}

/** Tabs from the page's current focus until `target` is focused, keyboard only (no click ever). */
async function tabTo(page: Page, target: Locator, maxHops = 80): Promise<void> {
  for (let hops = 0; hops < maxHops; hops += 1) {
    if (await target.evaluate((el) => el === document.activeElement).catch(() => false)) return;
    await page.keyboard.press("Tab");
  }
  await expect(target).toBeFocused();
}

test("opens the bundle's locked form, and Fill in focuses the first missing field (INIT-01) @smoke", async ({ page }) => {
  await seedProject(page, { project: recipeProject("GovernedVault") });
  const plan = await openInitPlanViaPalette(page);

  // Spec L460: "one locked step with one form: asset, name, symbol, decimals offset, min delay, voting delay,
  // voting period, proposal threshold and quorum" — the labels `labelFor` actually produces (fields.ts).
  for (const label of [
    "Asset", "Name", "Symbol", "Decimals offset", "Min delay", "Voting delay", "Voting period",
    "Proposal threshold", "Governor quorum",
  ]) {
    await expect(plan.field(label)).toBeVisible();
  }
  // The bundle is one locked step: no ↑/↓ on it, and it carries the lock icon (spec L467: "A bundle shows its
  // fixed order and none of these controls").
  await expect(plan.root.getByRole("button", { name: /^Move / })).toHaveCount(0);
  await expect(plan.root.getByRole("img", { name: "Locked" })).toBeVisible();

  // INIT-01 shows inline on the missing field …
  await expect(plan.root.getByText(ASSET_MISSING)).toBeVisible();
  // … and Fill in (the plan's own button, `init.focusField` at the first missing path) moves focus there.
  await plan.fillIn.click();
  await expect(plan.field("Asset")).toBeFocused();
});

test("committing a duration field sets it and updates the dot; Esc reverts an untouched edit", async ({ page }) => {
  await seedProject(page, { project: recipeProject("GovernedVault") });
  const plan = await openInitPlanViaPalette(page);

  // Min delay starts as the overlay's example (300 s), echoed as `duration.ts` writes it, dot "Example". (Voting
  // period also happens to echo "= 600 s" once Min delay is edited below, so this file reads each field's own
  // accessible description — `aria-describedby`, the same relationship `SheetPage.isSelected` reads — rather
  // than a page-wide `getByText`, which would be ambiguous between fields that land on the same echoed seconds.)
  const minDelay = plan.field("Min delay");
  await expect(minDelay).toHaveValue("5");
  expect(await plan.fieldDescription("Min delay")).toContain(MIN_DELAY_EXAMPLE_ECHO);
  expect(await plan.fieldDescription("Min delay")).toContain("Example");

  // Spec L463's own echo ("= 5 minutes") shows once the *shown* unit no longer matches the value's best unit
  // (`duration.ts`'s `durationEcho`). Picking a unit "commits the amount in that unit" (`DurationInput.tsx`'s own
  // doc comment): it reinterprets the number currently shown, it doesn't convert it, so picking "seconds" here
  // turns "5" (minutes) into 5 *seconds* first — confirmed empirically, not assumed.
  await plan.fieldUnit("Min delay").click();
  await page.getByRole("option", { name: "seconds" }).click();
  await expect(minDelay).toHaveValue("5"); // reinterpreted, not converted: 5 s, not 300 s.
  // Typing the overlay's own example amount (300) back in, now that "seconds" is the shown unit, reaches the
  // literal echo — and the dot reads "Example" again, since the *value* (300) is what the dot tracks, not
  // whether a commit action ran (also confirmed empirically): the overlay's example is 300 either way.
  await minDelay.fill("300");
  await minDelay.press("Enter");
  await expect(minDelay).toHaveValue("300");
  expect(await plan.fieldDescription("Min delay")).toContain("= 5 minutes");
  expect(await plan.fieldDescription("Min delay")).toContain("Example");

  // Committing a value that actually differs from the example is what flips the dot: 600 s (still shown in
  // seconds, so this also exercises the echo's word form again, "= 10 minutes").
  await minDelay.fill("600");
  await minDelay.press("Enter");
  expect(await plan.fieldDescription("Min delay")).toContain("= 10 minutes");
  expect(await plan.fieldDescription("Min delay")).toContain("Set by you");
  expect(await plan.fieldDescription("Min delay")).not.toContain("Example");

  // Voting delay: type without committing, then Esc — the stored example (60 s) comes back.
  const votingDelay = plan.field("Voting delay");
  await expect(votingDelay).toHaveValue("1");
  expect(await plan.fieldDescription("Voting delay")).toContain(VOTING_DELAY_EXAMPLE_ECHO);
  await votingDelay.fill("45");
  await votingDelay.press("Escape");
  await expect(votingDelay).toHaveValue("1");
  expect(await plan.fieldDescription("Voting delay")).toContain(VOTING_DELAY_EXAMPLE_ECHO);
  expect(await plan.fieldDescription("Voting delay")).toContain("Example");
});

test("committing the Asset field clears its INIT-01 blocker, in the field and in Problems", async ({ page }) => {
  await seedProject(page, { project: recipeProject("GovernedVault") });
  const plan = await openInitPlanViaPalette(page);
  const consoleRegion = page.getByRole("region", { name: "Console" });

  const asset = plan.field("Asset");
  await expect(plan.root.getByText(ASSET_MISSING)).toBeVisible();
  await expect(asset).toHaveAttribute("aria-invalid", "true");
  await expect(plan.fillIn).toBeVisible(); // InitEditor renders it only while `firstMissing` finds one.
  await expect(consoleRegion.getByText("1 blocker · 1 warning")).toBeVisible();

  await asset.fill(ASSET_EXAMPLE_ADDRESS);
  await asset.press("Enter");

  await expect(plan.root.getByText(ASSET_MISSING)).toHaveCount(0);
  await expect(asset).not.toHaveAttribute("aria-invalid", "true");
  expect(await plan.fieldDescription("Asset")).toContain("Set by you");
  // INIT-01 is gone from Problems too: the console's blocker count drops, Fill in has nothing left to find.
  await expect(consoleRegion.getByText("1 warning", { exact: true })).toBeVisible();
  await expect(consoleRegion.getByText(/1 blocker/)).toHaveCount(0);
  await expect(plan.fillIn).toHaveCount(0);
});

test("the same field-commit flow, keyboard only (no pointer events after the page loads)", async ({ page }) => {
  await seedProject(page, { project: recipeProject("GovernedVault") });
  const plan = await openInitPlanViaPalette(page);

  // Tabbing into a text input selects its contents (every browser's default), so typing next replaces it —
  // no explicit "select all" chord is needed.
  const minDelay = plan.field("Min delay");
  await tabTo(page, minDelay);
  await page.keyboard.type("10");
  await page.keyboard.press("Enter");
  expect(await plan.fieldDescription("Min delay")).toContain("= 600 s");
  expect(await plan.fieldDescription("Min delay")).toContain("Set by you");

  const votingDelay = plan.field("Voting delay");
  await tabTo(page, votingDelay);
  await page.keyboard.type("45");
  await page.keyboard.press("Escape");
  await expect(votingDelay).toHaveValue("1");
  expect(await plan.fieldDescription("Voting delay")).toContain("Example");

  // The Asset commit, keyboard only too: this is what actually clears INIT-01 (spec L466, INIT-01).
  const asset = plan.field("Asset");
  await tabTo(page, asset);
  await page.keyboard.type(ASSET_EXAMPLE_ADDRESS);
  await page.keyboard.press("Enter");
  await expect(plan.root.getByText(ASSET_MISSING)).toHaveCount(0);
  expect(await plan.fieldDescription("Asset")).toContain("Set by you");
});

test("a step init's automatic ERC-165 step shows locked with its exact title (spec L468)", async ({ page }) => {
  await seedProject(page, { project: recipeProject("ERC20", { filled: true }) });
  const plan = await openInitPlanViaPalette(page);

  await expect(plan.root.getByRole("list", { name: "Steps in call order" })).toBeVisible();
  const automatic = plan.step(AUTOMATIC_ERC165_TITLE);
  await expect(automatic).toBeVisible();
  await expect(automatic.getByRole("img", { name: "Locked" })).toBeVisible();
  // Locked: neither of its own ↑/↓ buttons render (StepCard's `canMove` is false once `step.locked`).
  await expect(automatic.getByRole("button", { name: /^Move DiamondIntrospectionInit/ })).toHaveCount(0);

  // ERC20Init, the one editable step, does get ↑/↓ (`movable` is 1, not null) — both disabled at the list's
  // one edge, since there's nowhere else to move it (no second movable step; see this file's header comment).
  await expect(plan.moveStepButton("ERC20Init", "up")).toHaveAttribute("aria-disabled", "true");
  await expect(plan.moveStepButton("ERC20Init", "down")).toHaveAttribute("aria-disabled", "true");
  await expect(plan.reorderAuto).toHaveCount(0);
});

test("a bundle's internal order is listed read-only from the overlay, with no reorder controls", async ({ page }) => {
  await seedProject(page, { project: recipeProject("GovernedVault", { filled: true }) });
  const plan = await openInitPlanViaPalette(page);

  await expect(plan.bundleOrderHeading).toHaveText("Order inside GovernedVaultInit");
  await expect(plan.bundleOrderNote).toBeVisible();
  // The overlay's sequence (overlay/inits/defi.yaml's GovernedVaultInit modules), in order: the `<ol>` shares
  // the section's heading through `aria-labelledby` (`BundleOrder.tsx`), so it carries the same accessible name.
  const sequence = plan.root.getByRole("list", { name: "Order inside GovernedVaultInit" });
  await expect(sequence.getByText("AccessControl", { exact: true })).toBeVisible();
  await expect(sequence.getByText("GovernedVault", { exact: true })).toBeVisible();
});

test("the Authority table shows role, holder and how each is held, live under the plan (spec L469)", async ({ page }) => {
  await seedProject(page, { project: recipeProject("GovernedVault", { filled: true }) });
  const plan = await openInitPlanViaPalette(page);

  await expect(plan.authorityTable).toBeVisible();
  const rows: readonly [string, string, string][] = [
    ["DEFAULT_ADMIN_ROLE", "This diamond", "GovernedVaultInit (the diamond itself)"],
    ["Upgrade", "This diamond", "GovernedDiamondCut (governance through the timelock)"],
    ["Guardian", "none", "EmergencyStop (no guardian at init)"],
    ["Proposer", "This diamond", "GovernedVaultInit (the diamond's Governor)"],
    ["Executor", "anyone", "GovernedVaultInit (open execution)"],
  ];
  for (const [role, holder, via] of rows) {
    await expect(plan.root.getByRole("rowheader", { name: role, exact: true })).toBeVisible();
    expect(await plan.authorityHolder(role)).toBe(holder);
    expect(await plan.authorityVia(role)).toBe(via);
  }
  // Flow 17 (a different helper's WP) starts from the Upgrade row's own button; only it carries one.
  await expect(plan.changeUpgradeButton("Upgrade")).toBeVisible();
  for (const [role] of rows) {
    if (role !== "Upgrade") await expect(plan.changeUpgradeButton(role)).toHaveCount(0);
  }
});

test("Init plan in the Structure tree opens it too (spec L459's Structure entry point)", async ({ page }) => {
  await seedProject(page, { project: recipeProject("GovernedVault") });
  await runInPalette(page, "Show Structure");
  const item = page.getByRole("treeitem", { name: /^Init plan, / });
  await expect(item).toBeVisible();
  await item.click();
  await page.keyboard.press("Enter");
  await expectInitPlanOpen(page);
});

for (const width of NARROW_WIDTHS) {
  test.describe(`at ${width} px`, () => {
    test.use({ viewport: viewportAt(width) });

    test("Fill in still opens the plan, wherever the tier puts the inspector (spec L367-L370)", async ({ page }) => {
      await seedProject(page, { project: recipeProject("GovernedVault") });
      const plan = await openInitPlanViaPalette(page);
      await expect(plan.field("Asset")).toBeVisible();
      await expect(plan.root.getByText(ASSET_MISSING)).toBeVisible();
      await plan.fillIn.click();
      await expect(plan.field("Asset")).toBeFocused();
    });
  });
}
