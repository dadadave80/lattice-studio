/**
 * Flow 5. Meet a missing dependency (spec L443-L449, IR "Sheet" pin row/note, "Inspector" Requires section,
 * "Console drawer", "Structure"). Scenarios are built from the real catalog (`fixtures.ts`): VaultCore requires
 * ERC4626 (DEP-01, hard, one option — the spec's own example), and the blank diamond's own
 * AccessControlDiamondCut/EmergencyStop pair for the DEP-02 companion (spec L449's "never blocks").
 *
 * The catalog has no hard requirement with more than one `anyOf` option, so "Compare options…" (`dependency.compare`,
 * spec L444) never has real data to exercise: every DEP-01 test below asserts it's absent from the note, and this
 * file records the gap rather than skip it silently (see the WP-Q1b report's Interpretations).
 */
import { expect, test } from "../_support/fixtures.ts";
import { seedProject } from "../_support/seed.ts";
import { expectTier, viewportAt } from "../_support/viewports.ts";
import { blankConvention, blankConventionMet, missingDependency } from "./fixtures.ts";
import { ConsolePage } from "./pages/console-page.ts";
import { InspectorPage } from "./pages/inspector-page.ts";
import { SheetPage } from "./pages/sheet-page.ts";
import { StructurePage } from "./pages/structure-page.ts";

const DEP01_TEXT =
  "VaultCore requires ERC4626: it runs the assets behind ERC4626's shares and initializes after it.";
const DEP02_TEXT = "AccessControlDiamondCut usually ships with EmergencyStop, so a guardian can halt upgrades.";
const MISSING_CAPTION = "Missing dependency";
const CONVENTION_CAPTION = "Convention";

test.describe("Flow 5: meet a missing dependency", () => {
  test("DEP-01 note offers Place ERC4626 and no Compare options… @smoke", async ({ page }) => {
    await seedProject(page, { project: missingDependency() });
    const sheet = new SheetPage(page);
    await sheet.fit();

    const note = sheet.note(MISSING_CAPTION);
    await expect(note).toBeVisible();
    await expect(note).toContainText(DEP01_TEXT);
    await expect(sheet.fixButton(note, "Place ERC4626")).toBeVisible();
    // The catalog's only hard requirement with a single `anyOf` option: no "Compare options…" to offer.
    await expect(note.getByRole("button", { name: /^Compare options…$/ })).toHaveCount(0);

    await expect(await sheet.borderOf("VaultCore")).toBe("caution");
    await expect(sheet.card("VaultCore")).toHaveAccessibleDescription(/needs ERC4626, which isn't on the sheet/i);
  });

  test("placing the option meets it, narrated both ways", async ({ page }) => {
    // The blank diamond (no VaultCore yet), so placing it in-test narrates the Missing line, then placing
    // ERC4626 narrates Dependency met — loading a project with the dependency already unmet or met narrates
    // nothing (`narrate(null, next)` returns `[]` on load).
    await seedProject(page, { project: blankConvention() });
    const sheet = new SheetPage(page);
    await sheet.fit();
    const console_ = new ConsolePage(page);

    await console_.run("place vaultcore");
    await expect(console_.line(`Missing ${DEP01_TEXT}`)).toBeVisible();
    await expect(sheet.note(MISSING_CAPTION)).toBeVisible();
    await expect(await sheet.borderOf("VaultCore")).toBe("caution");

    await console_.run("place erc4626");
    await expect(console_.line("Resolved Dependency met: VaultCore.")).toBeVisible();
    // "Placing puts the provider next to the dependent" (spec L446).
    await expect(sheet.card("ERC4626")).toBeVisible();
    await expect(sheet.card("VaultCore")).toHaveAccessibleDescription(/needs ERC4626/i);
    await expect(sheet.card("VaultCore")).not.toHaveAccessibleDescription(/isn't on the sheet/);

    // ERC4626 in turn requires ERC20 (its own DEP-01, a real chain in the catalog, not a spec example): the
    // "Missing dependency" caption is reused for ERC4626's own note the instant VaultCore's is resolved, so
    // this places ERC20 too before asserting the caption is gone outright.
    await console_.run("place erc20");
    await expect(console_.line("Resolved Dependency met: ERC4626.")).toBeVisible();
    await expect(sheet.note(MISSING_CAPTION)).toHaveCount(0);
  });

  test("removing the dependent clears the problem", async ({ page }) => {
    await seedProject(page, { project: missingDependency() });
    const sheet = new SheetPage(page);
    const console_ = new ConsolePage(page);
    await sheet.fit();
    await expect(sheet.note(MISSING_CAPTION)).toBeVisible();

    await console_.run("remove vaultcore");

    await expect(console_.line("Removed VaultCore.")).toBeVisible();
    await expect(sheet.note(MISSING_CAPTION)).toHaveCount(0);
    await expect(sheet.card("VaultCore")).toHaveCount(0);
  });

  test("a convention shows a quieter note and never blocks @smoke", async ({ page }) => {
    await seedProject(page, { project: blankConvention() });
    const sheet = new SheetPage(page);
    const console_ = new ConsolePage(page);
    await sheet.fit();

    const note = sheet.note(CONVENTION_CAPTION);
    await expect(note).toBeVisible();
    await expect(note).toContainText(DEP02_TEXT);
    await expect(sheet.fixButton(note, "Place EmergencyStop")).toBeVisible();
    await expect(await sheet.borderOf("AccessControlDiamondCut")).toBe("caution");
    // The spec's own claim (L449): a convention never blocks. Zero blockers on the blank diamond, so Deploy
    // is already enabled with the convention note still open.
    await expect(sheet.deployButton()).toBeEnabled();

    await sheet.fixButton(note, "Place EmergencyStop").click();
    // A generic Resolved line (DEP-02 isn't Missing/Dependency-met): substring match, since the exact
    // "Resolved" + "Resolved: …" double-tag rendering is unusual enough to call out rather than assert whole.
    await expect(console_.line(/AccessControlDiamondCut usually ships with EmergencyStop/)).toBeVisible();
    await expect(sheet.note(CONVENTION_CAPTION)).toHaveCount(0);
  });

  test("the convention note is gone once the companion is placed", async ({ page }) => {
    await seedProject(page, { project: blankConventionMet() });
    const sheet = new SheetPage(page);
    await sheet.fit();
    await expect(sheet.card("EmergencyStop")).toBeVisible();
    await expect(sheet.note(CONVENTION_CAPTION)).toHaveCount(0);
  });

  test("the Inspector's Requires list shows status and a fix", async ({ page }) => {
    await seedProject(page, { project: missingDependency() });
    const sheet = new SheetPage(page);
    const inspector = new InspectorPage(page);
    await sheet.fit();

    // A single click only selects; double-click opens the card in the Inspector (IR "Pointer and touch").
    await sheet.card("VaultCore").dblclick();
    const requirement = inspector.requirement("ERC4626");
    await expect(requirement).toContainText("Missing");
    // Same command, from a second place (spec L425's "or in the inspector's Requires list").
    await requirement.getByRole("button", { name: "Place ERC4626" }).click();

    // Placing selects the newly-placed facet (ERC4626): back to VaultCore's own Facet view to re-check its row.
    await sheet.card("VaultCore").dblclick();
    await expect(inspector.requirement("ERC4626")).toContainText("Met by ERC4626");
  });

  test("the Structure tree shows the dependency's problem", async ({ page }) => {
    await seedProject(page, { project: missingDependency() });
    const structure = new StructurePage(page);
    await structure.open();

    await expect(structure.facet("VaultCore")).toBeVisible();
    await expect(structure.problem(`Blocker: ${DEP01_TEXT}`)).toBeVisible();
  });

  test.describe("keyboard-only", () => {
    test("F8 to the note, Tab to Place ERC4626, Enter @smoke", async ({ page }) => {
      await seedProject(page, { project: missingDependency() });
      const sheet = new SheetPage(page);
      const console_ = new ConsolePage(page);
      // A fresh page needs its first paint settled before F8 is guaranteed wired up (lost an hour to this in
      // Flow 4 without it).
      await expect(sheet.card("VaultCore")).toBeVisible();

      const note = await sheet.revealNote(MISSING_CAPTION);
      await page.keyboard.press("Tab");
      const place = sheet.fixButton(note, "Place ERC4626");
      await expect(place).toBeFocused();
      await page.keyboard.press("Enter");

      await expect(console_.line("Resolved Dependency met: VaultCore.")).toBeVisible();
      // ERC4626 in turn requires ERC20 (its own DEP-01, not a spec example, a real chain in the catalog): the
      // "Missing dependency" caption is reused for ERC4626's own note, so this completes the chain too, entirely
      // from the keyboard, before asserting the caption is gone outright.
      await console_.run("place erc20");
      await expect(console_.line("Resolved Dependency met: ERC4626.")).toBeVisible();
      await expect(sheet.note(MISSING_CAPTION)).toHaveCount(0);
    });

    test("console verb path: place erc4626 meets the dependency", async ({ page }) => {
      await seedProject(page, { project: missingDependency() });
      const sheet = new SheetPage(page);
      const console_ = new ConsolePage(page);
      await sheet.fit();

      await console_.run("place erc4626");
      await expect(console_.line("Resolved Dependency met: VaultCore.")).toBeVisible();

      await console_.run("place erc20");
      await expect(console_.line("Resolved Dependency met: ERC4626.")).toBeVisible();
      await expect(sheet.note(MISSING_CAPTION)).toHaveCount(0);
    });
  });

  test.describe("reduced motion", () => {
    test.use({ reducedMotion: "reduce" });

    test("the note disappears at once once the dependency is met", async ({ page }) => {
      await seedProject(page, { project: missingDependency() });
      const sheet = new SheetPage(page);
      const console_ = new ConsolePage(page);
      const note = await sheet.revealNote(MISSING_CAPTION);
      await sheet.fixButton(note, "Place ERC4626").click();
      await expect(console_.line("Resolved Dependency met: VaultCore.")).toBeVisible();
      // ERC4626 immediately raises its own "Missing dependency" note (it needs ERC20 in turn, a real chain in
      // the catalog), so this checks the specific note that just resolved is gone, not the caption outright.
      await expect(page.getByText(DEP01_TEXT)).toHaveCount(0);
    });
  });

  test.describe("at 768 px (narrow: the panes become overlay toggles)", () => {
    test.use({ viewport: viewportAt(768) });

    test("the note and its button still work", async ({ page }) => {
      await seedProject(page, { project: missingDependency() });
      const sheet = new SheetPage(page);
      const console_ = new ConsolePage(page);
      await expectTier(page, "narrow");

      const note = await sheet.revealNote(MISSING_CAPTION); // notes stay on the sheet at every width (IR "Sheet")
      await sheet.fixButton(note, "Place ERC4626").click();

      // F8's own selection change opens the inspector overlay at this width, which (one drawer at a time)
      // closes the console: reopen it, as a returning visitor at this width would, before reading the log.
      const expandConsole = page.getByRole("button", { name: "Expand console" });
      if (await expandConsole.isVisible()) await expandConsole.click();

      await expect(console_.line("Resolved Dependency met: VaultCore.")).toBeVisible();
    });
  });

  test.describe("at 375 px (phone: Sheet, Structure, Catalog, Inspector, Console as tabs)", () => {
    test.use({ viewport: viewportAt(375) });

    test("the note and its button still work from the Sheet tab", async ({ page }) => {
      await seedProject(page, { project: missingDependency() });
      const sheet = new SheetPage(page);
      const console_ = new ConsolePage(page);
      await expectTier(page, "phone");

      // The pane switcher starts on Sheet; F8 at this tier can switch it to Inspector to show the problem,
      // which would unmount the note along with the rest of the Sheet pane, so this reaches the note directly
      // rather than through F8's reveal (a real user opens the same note here, since it's already the pane in
      // view on a first or returning visit).
      await page.getByRole("tab", { name: "Sheet" }).click();
      await sheet.fit();
      const note = sheet.note(MISSING_CAPTION);
      await expect(note).toBeVisible();
      await sheet.fixButton(note, "Place ERC4626").click();

      await page.getByRole("tab", { name: "Console" }).click();
      await expect(console_.line("Resolved Dependency met: VaultCore.")).toBeVisible();
    });
  });
});
