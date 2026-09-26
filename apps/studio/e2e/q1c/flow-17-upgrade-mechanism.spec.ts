/**
 * Flow 17. Choose an upgrade mechanism (spec L640-L652; IR L175).
 *
 * One dialog handles every fix that changes authority: CORE-02's "Choose an upgrade mechanism…", AUTH-01's
 * "Use a Safe…" and "Use governance…", and the Authority table's Upgrade row. It shows everything that will
 * change before anything does, and applies as one undo step.
 *
 * Two projects this file builds itself, with core, rather than relying on a catalog template:
 * - `immutableDiamond()`: the real "Blank diamond" template (`plan/templates.ts`) already places
 *   AccessControlDiamondCut, so its current mechanism is Admin role, not Immutable — confirmed by reading
 *   `plan/templates.ts` and running `mechanismOptions` against it (see the WP-Q1c report's Interpretations).
 *   This file instead applies Flow 17's own "Immutable" choice to the Blank diamond first, with core's
 *   `planMechanismChange`, to get a diamond whose current option genuinely is Immutable, for the round-trip
 *   this suite exercises.
 * - `recipeProject("Blank diamond")` as it actually loads (current: Admin role) for the Governance-disabled and
 *   Safe-path tests, where the starting mechanism doesn't matter.
 *
 * Environment workarounds this file relies on (see `flow-09-undo-redo.spec.ts`'s header and the WP-Q1c report's
 * Follow-ups): `pages/palette-page.ts`'s `runInPalette` (the working ⌘/Ctrl+K chord) and `pages/mod-key.ts`. This
 * file also can't use `_support/wallet.ts`'s `connectMockWallet` as it stands: it calls `_support/keys.ts`'s
 * `runConsole` and `runInPalette`, the same broken ⌘/Ctrl+K helpers flow-09 works around, so `connectWallet`
 * below reimplements its three steps (chain, connect, switch) with this file's fixed page objects instead. See
 * the WP-Q1c report's Follow-ups.
 */
import type { Page } from "@playwright/test";
import { blankDiamond, formatAddress, planMechanismChange } from "@lattice-studio/core";
import { expect, test } from "../_support/fixtures.ts";
import { ALICE, SAFE } from "../_support/anvil.ts";
import { catalog as builtCatalog } from "../_support/catalog.ts";
import { projectFor, recipeProject } from "../_support/projects.ts";
import { seedProject } from "../_support/seed.ts";
import { NARROW_WIDTHS, viewportAt } from "../_support/viewports.ts";
import { MOCK_ACCOUNT, shortAddress } from "../_support/wallet.ts";
import { consoleLog, runConsoleCommand } from "./pages/console-page.ts";
import { MechanismDialogPage } from "./pages/mechanism-dialog-page.ts";
import { runInPalette } from "./pages/palette-page.ts";
import { SheetPage } from "./pages/sheet-page.ts";
import { TitleBarPage } from "./pages/title-bar-page.ts";

/** Spec L648, quoted verbatim (`GOVERNANCE_DISABLED` in `packages/core/src/authority/semantics.ts`). */
const GOVERNANCE_DISABLED =
  "Governance needs GovernedVault's Governor, Votes and TimelockController; Lattice has no standalone Governor init.";

const CHOOSE_MECHANISM = "Choose an upgrade mechanism…";

/** A diamond whose current upgrade mechanism genuinely is Immutable (see this file's header). */
function immutableDiamond() {
  const catalog = builtCatalog();
  const applied = planMechanismChange(blankDiamond(catalog), catalog, "immutable", {});
  if (!applied.ok) throw new Error(applied.error);
  return projectFor(applied.value.next, "Immutable diamond");
}

async function expectDialogClosed(page: Page): Promise<void> {
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * `_support/wallet.ts`'s `connectMockWallet`, reimplemented with this file's fixed console and palette helpers
 * (see the file header): selects Anvil, connects the mock wallet and switches it there, keyboard only.
 */
async function connectWallet(page: Page): Promise<void> {
  const log = page.getByRole("log");
  await runConsoleCommand(page, "chain anvil");
  await runInPalette(page, "Connect wallet");
  await expect(log.getByText(`Connected ${shortAddress(MOCK_ACCOUNT)}`, { exact: false })).toBeVisible();
  await runInPalette(page, "Switch network");
  await expect(log.getByText("Switched your wallet to Anvil.", { exact: false })).toBeVisible();
}

test("opens from the palette with the current option focused, and previews a choice before applying it", async ({ page }) => {
  await seedProject(page, { project: immutableDiamond() });
  await runInPalette(page, CHOOSE_MECHANISM);
  const dialog = new MechanismDialogPage(page);
  await dialog.waitFor();

  // Initial focus is the current option (IR L175); the current option here is Immutable.
  await expect(dialog.radio("Immutable")).toHaveAttribute("aria-checked", "true");
  await expect(dialog.radio("Immutable")).toBeFocused();

  await dialog.radio("Admin role").click();
  // `optionDescription` (mechanism-form.ts), quoted exactly.
  await expect(dialog.radio("Admin role")).toHaveAccessibleDescription(
    "AccessControlDiamondCut: holders of DEFAULT_ADMIN_ROLE cut at once.",
  );
  // The preview (spec L651), computed by core's `planMechanismChange` for this exact recipe.
  for (const line of [
    "Place AccessControlDiamondCut",
    "Place EmergencyStop",
    "Place AccessControl",
    "Init: add AccessControlInit(admin); the automatic ERC-165 step switches to initUpgradeable",
    "Upgrade → Deploying account, through DEFAULT_ADMIN_ROLE",
    "Clear Keep immutable",
  ]) {
    await expect(dialog.preview.getByText(line, { exact: true })).toBeVisible();
  }

  // Nothing applied yet: Cancel leaves the document alone.
  await dialog.cancelButton.click();
  await expectDialogClosed(page);
  const sheet = new SheetPage(page);
  await expect(sheet.card("AccessControlDiamondCut")).toHaveCount(0);
});

test("applies Admin role as one undo step, and the console and status line say so @smoke", async ({ page }) => {
  await seedProject(page, { project: immutableDiamond() });
  const sheet = new SheetPage(page);
  const titleBar = new TitleBarPage(page);

  await runInPalette(page, CHOOSE_MECHANISM);
  const dialog = new MechanismDialogPage(page);
  await dialog.waitFor();
  await dialog.radio("Admin role").click();
  await dialog.applyButton("Use AccessControlDiamondCut").click();
  await expectDialogClosed(page);

  // The whole change lands as one step: the new facets and the Authority table's holder together.
  await expect(sheet.card("AccessControlDiamondCut")).toBeVisible();
  await expect(sheet.card("EmergencyStop")).toBeVisible();
  const applied = "Upgrade mechanism: AccessControlDiamondCut.";
  await expect(page.getByRole("status")).toContainText(applied);
  await expect(consoleLog(page)).toContainText(applied);

  // One undo restores the whole previous mechanism, its facets and its init, not a partial step.
  await titleBar.undo();
  await expect(sheet.card("AccessControlDiamondCut")).toHaveCount(0);
  await expect(sheet.card("EmergencyStop")).toHaveCount(0);
  const undone = "Undid: Use AccessControlDiamondCut.";
  await expect(page.getByRole("status")).toContainText(undone);
  await expect(consoleLog(page)).toContainText(undone);
});

test("a bundle that sets up its own mechanism decides it, and the dialog offers only Cancel", async ({ page }) => {
  await seedProject(page, { project: recipeProject("GovernedVault", { filled: true }) });
  await runInPalette(page, CHOOSE_MECHANISM);
  const dialog = new MechanismDialogPage(page);
  await dialog.waitFor();

  // The dialog's own description names the bundle (spec L651's rule, quoted from `ChooseMechanismDialog.tsx`).
  await expect(dialog.root).toHaveAccessibleDescription(
    "GovernedVaultInit sets up the upgrade mechanism itself, so the bundle decides it.",
  );
  await expect(dialog.radio("Governance")).toHaveAttribute("aria-checked", "true");
  await expect(dialog.radio("Safe")).toHaveAttribute("aria-disabled", "true");
  // No primary button at all while a bundle decides it — only Cancel.
  await expect(dialog.root.getByRole("button", { name: /^Use / })).toHaveCount(0);
  await expect(dialog.cancelButton).toBeVisible();

  await dialog.cancelButton.click();
  await expectDialogClosed(page);
});

test("Governance stays disabled with its reason outside GovernedVault", async ({ page }) => {
  await seedProject(page, { project: recipeProject("Blank diamond") });
  await runInPalette(page, CHOOSE_MECHANISM);
  const dialog = new MechanismDialogPage(page);
  await dialog.waitFor();

  // The radio's accessible description carries the reason (`ReasonTooltip`'s hidden span, joined onto the
  // option's own description); the same text is also written where everyone can read it (`data-reason`'s
  // sibling span), but that duplicates the text as a second DOM node, so the accessible-description check is
  // the one that resolves to exactly one element.
  await expect(dialog.radio("Governance")).toHaveAttribute("aria-disabled", "true");
  await expect(dialog.radio("Governance")).toHaveAccessibleDescription(new RegExp(escapeRegExp(GOVERNANCE_DISABLED)));

  await dialog.cancelButton.click();
  await expectDialogClosed(page);
});

test("the Safe path: INIT-01's chain check flags a non-Safe address and clears for a real one, then applies", async ({
  page,
  anvil,
}) => {
  expect(await anvil.client.getChainId()).toBe(31337);
  await seedProject(page, { project: recipeProject("Blank diamond") });
  await connectWallet(page);

  // Opening plainly and choosing Safe, rather than through AUTH-01's "Use a Safe…" preset: that preset is a
  // problem fix (`checks/auth.ts`), surfaced only while AUTH-01 is active, which this project doesn't need.
  await runInPalette(page, CHOOSE_MECHANISM);
  const dialog = new MechanismDialogPage(page);
  await dialog.waitFor();
  await dialog.radio("Safe").click();

  const noSafeYet = "No Safe at this address on Anvil yet. Deploy the Safe first.";
  await dialog.safeAddressField.fill(ALICE);
  await expect(dialog.root.getByText(noSafeYet)).toBeVisible();

  await dialog.safeAddressField.fill(SAFE);
  await expect(dialog.root.getByText(noSafeYet)).toHaveCount(0);
  await dialog.thresholdField.fill("2");

  await dialog.applyButton("Use SafeDiamondCut").click();
  await expectDialogClosed(page);

  const sheet = new SheetPage(page);
  await expect(sheet.card("SafeDiamondCut")).toBeVisible();
  await expect(sheet.card("AccessControlDiamondCut")).toHaveCount(0);
  const applied = `Upgrade mechanism: SafeDiamondCut · Safe ${formatAddress(SAFE)}.`;
  await expect(page.getByRole("status")).toContainText(applied);
  await expect(consoleLog(page)).toContainText(applied);
});

test("keyboard only: arrow keys choose Admin role, Tab reaches Apply, Enter applies it", async ({ page }) => {
  await seedProject(page, { project: immutableDiamond() });
  const sheet = new SheetPage(page);

  await runInPalette(page, CHOOSE_MECHANISM);
  const dialog = new MechanismDialogPage(page);
  await dialog.waitFor();
  await expect(dialog.radio("Immutable")).toBeFocused();

  // ArrowUp from Immutable (the last option) walks toward the first without needing wrap-around: Safe with
  // delay, then Safe, then Admin role, skipping Governance since Base UI's radio group skips `aria-disabled`
  // radios (RadioGroup.tsx's doc comment). A bounded walk rather than a fixed press count, so it still finds
  // Admin role if that skip takes more or fewer presses than expected.
  const adminRole = dialog.radio("Admin role");
  for (let presses = 0; presses < 4; presses += 1) {
    if ((await adminRole.getAttribute("aria-checked")) === "true") break;
    await page.keyboard.press("ArrowUp");
  }
  await expect(adminRole).toHaveAttribute("aria-checked", "true");
  await expect(adminRole).toBeFocused();

  const apply = dialog.applyButton("Use AccessControlDiamondCut");
  for (let presses = 0; presses < 8; presses += 1) {
    if (await apply.evaluate((el) => el === document.activeElement)) break;
    await page.keyboard.press("Tab");
  }
  await expect(apply).toBeFocused();
  await page.keyboard.press("Enter");

  await expectDialogClosed(page);
  await expect(sheet.card("AccessControlDiamondCut")).toBeVisible();
});

for (const width of NARROW_WIDTHS) {
  test.describe(`at ${width} px`, () => {
    test.use({ viewport: viewportAt(width) });

    // The dialog itself doesn't restructure at narrow widths the way panes do (`Dialog.tsx`: full screen under
    // 768 px either way, same roles throughout) — only how it's reached could move, and the palette is an
    // overlay above every pane regardless of width (as `flow-09-undo-redo.spec.ts` notes for the same reason).
    // So this is a light smoke test, not a distinct narrow-layout claim.
    test(`still opens through the palette and applies`, async ({ page }) => {
      await seedProject(page, { project: immutableDiamond() });
      const sheet = new SheetPage(page);

      await runInPalette(page, CHOOSE_MECHANISM);
      const dialog = new MechanismDialogPage(page);
      await dialog.waitFor();
      await dialog.radio("Admin role").click();
      await dialog.applyButton("Use AccessControlDiamondCut").click();
      await expectDialogClosed(page);

      await expect(sheet.card("AccessControlDiamondCut")).toBeVisible();
    });
  });
}
