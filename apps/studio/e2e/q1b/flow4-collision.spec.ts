/**
 * Flow 4. Resolve a collision (spec L432-L442, IR "Sheet" pin row, "Command palette", "Console drawer",
 * "Context menus", "Dialogs"). Every scenario is built from the real catalog (`fixtures.ts`), the same
 * AxelarGatewayAdapter/HyperlaneGatewayAdapter pair the spec itself illustrates (their real selectors:
 * `sendMessage(bytes,bytes,bytes[])` 0xcdfe7f5c and `supportsAttribute(bytes4)` 0xdc680a0f).
 *
 * "Deploy enables once no blockers remain" (spec L438) is tested on `cleanCollision`/`cleanCollisionResolved`
 * (Governor and Votes), not the Axelar/Hyperlane pair: both gateway adapters also raise INIT-04 (no init step
 * in the catalog), so resolving their collision alone never reaches zero blockers. That's a real property of
 * the pinned catalog, not a gap in the flow, so it's called out here rather than asserted against silently.
 */
import { expect, test } from "../_support/fixtures.ts";
import { runInPalette } from "../_support/keys.ts";
import { seedProject } from "../_support/seed.ts";
import { expectTier, viewportAt } from "../_support/viewports.ts";
import { ChoosePerSelectorDialogPage } from "./pages/choose-per-selector-dialog.ts";
import { ConsolePage } from "./pages/console-page.ts";
import { SheetPage } from "./pages/sheet-page.ts";
import { StructurePage } from "./pages/structure-page.ts";
import {
  beforeTwoWayCollision, cleanCollision, cleanCollisionResolved, seamOverrideRecipe, seamRecipe, threeWayCollision,
  twoWayCollision,
} from "./fixtures.ts";

const SEND_MESSAGE = "sendMessage(bytes,bytes,bytes[])";
const SUPPORTS_ATTRIBUTE = "supportsAttribute(bytes4)";
const SEND_MESSAGE_HEX = "0xcdfe7f5c";
const SUPPORTS_ATTRIBUTE_HEX = "0xdc680a0f";
const RULE = "Only one facet can serve each selector.";
const COLLISION_CAPTION = "Selector collision · 2";

test.describe("Flow 4: resolve a collision", () => {
  test("the note, and narration only on a change @smoke", async ({ page }) => {
    await seedProject(page, { project: beforeTwoWayCollision() });
    const sheet = new SheetPage(page);
    await sheet.fit();
    const console_ = new ConsolePage(page);

    // Loading a project with a collision already in it narrates nothing (a load resets the baseline): the
    // Collision line only appears once placing Hyperlane actually changes the analysis.
    await expect(console_.line(/^Collision /)).toHaveCount(0);

    await console_.run("place hyperlanegatewayadapter");
    await expect(
      console_.line(
        "Collision AxelarGatewayAdapter and HyperlaneGatewayAdapter both export sendMessage · 0xcdfe7f5c and supportsAttribute · 0xdc680a0f. Choose an owner.",
      ),
    ).toBeVisible();

    const note = sheet.note(COLLISION_CAPTION);
    await expect(note).toBeVisible();
    await expect(note).toContainText(RULE);
    await expect(note.getByText(SEND_MESSAGE)).toBeVisible();
    await expect(note.getByText(SUPPORTS_ATTRIBUTE)).toBeVisible();
    await expect(sheet.keepButton(note, "AxelarGatewayAdapter")).toBeVisible();
    await expect(sheet.routeButton(note, "HyperlaneGatewayAdapter")).toBeVisible();
    // Choose per selector… is offered whenever the set has more than one selector, at any contender count.
    await expect(sheet.choosePerSelectorButton(note)).toBeVisible();
  });

  test("contested pins on both cards @smoke", async ({ page }) => {
    await seedProject(page, { project: twoWayCollision() });
    const sheet = new SheetPage(page);
    await sheet.fit();

    // Each card's rival is the other card: Axelar's pins name Hyperlane, Hyperlane's name Axelar.
    await expect(sheet.pinLike("AxelarGatewayAdapter", `${SEND_MESSAGE} ${SEND_MESSAGE_HEX}, contested with HyperlaneGatewayAdapter`)).toBeVisible();
    await expect(sheet.pinLike("AxelarGatewayAdapter", `${SUPPORTS_ATTRIBUTE} ${SUPPORTS_ATTRIBUTE_HEX}, contested with HyperlaneGatewayAdapter`)).toBeVisible();
    await expect(sheet.pinLike("HyperlaneGatewayAdapter", `${SEND_MESSAGE} ${SEND_MESSAGE_HEX}, contested with AxelarGatewayAdapter`)).toBeVisible();
    await expect(sheet.pinLike("HyperlaneGatewayAdapter", `${SUPPORTS_ATTRIBUTE} ${SUPPORTS_ATTRIBUTE_HEX}, contested with AxelarGatewayAdapter`)).toBeVisible();
    await expect(await sheet.borderOf("AxelarGatewayAdapter")).toBe("conflict");
    await expect(await sheet.borderOf("HyperlaneGatewayAdapter")).toBe("conflict");
  });

  test("Keep {A} resolves the whole set", async ({ page }) => {
    await seedProject(page, { project: twoWayCollision() });
    const sheet = new SheetPage(page);
    const console_ = new ConsolePage(page);
    const note = await sheet.revealNote(COLLISION_CAPTION);

    await sheet.keepButton(note, "AxelarGatewayAdapter").click();

    await expect(
      console_.line("Resolved: sendMessage · 0xcdfe7f5c and supportsAttribute · 0xdc680a0f route to AxelarGatewayAdapter."),
    ).toBeVisible();
    await expect(note).toHaveCount(0);
    await expect(sheet.pinLike("AxelarGatewayAdapter", `${SEND_MESSAGE} ${SEND_MESSAGE_HEX}, routes here`)).toBeVisible();
    // HyperlaneGatewayAdapter has more than the expand threshold's worth of selectors, and once resolved
    // sendMessage is no longer contested, a collapsed card can tuck its row behind "+ n more" (C9's
    // `visibleRows` guarantees only contested rows stay visible while collapsed, and this one just stopped
    // being one).
    await sheet.expandCard("HyperlaneGatewayAdapter");
    await expect(
      sheet.pinLike("HyperlaneGatewayAdapter", `${SEND_MESSAGE} ${SEND_MESSAGE_HEX}, served by AxelarGatewayAdapter`),
    ).toBeVisible();
    await expect(await sheet.borderOf("AxelarGatewayAdapter")).toBe("caution"); // INIT-04 still on it
    await expect(await sheet.borderOf("HyperlaneGatewayAdapter")).toBe("caution");
  });

  test("Route to {B} resolves the whole set the other way", async ({ page }) => {
    await seedProject(page, { project: twoWayCollision() });
    const sheet = new SheetPage(page);
    const console_ = new ConsolePage(page);
    const note = await sheet.revealNote(COLLISION_CAPTION);

    await sheet.routeButton(note, "HyperlaneGatewayAdapter").click();

    await expect(
      console_.line("Resolved: sendMessage · 0xcdfe7f5c and supportsAttribute · 0xdc680a0f route to HyperlaneGatewayAdapter."),
    ).toBeVisible();
    await expect(
      sheet.pinLike("AxelarGatewayAdapter", `${SEND_MESSAGE} ${SEND_MESSAGE_HEX}, served by HyperlaneGatewayAdapter`),
    ).toBeVisible();
  });

  test("the recipe JSON records the owner choice", async ({ page }) => {
    await seedProject(page, { project: twoWayCollision() });
    const sheet = new SheetPage(page);
    const console_ = new ConsolePage(page);
    const note = await sheet.revealNote(COLLISION_CAPTION);
    await sheet.keepButton(note, "AxelarGatewayAdapter").click();

    const recipeJson = await console_.recipeJson();
    await expect(recipeJson).toContainText(`"${SEND_MESSAGE_HEX}": "AxelarGatewayAdapter"`);
    await expect(recipeJson).toContainText(`"${SUPPORTS_ATTRIBUTE_HEX}": "AxelarGatewayAdapter"`);
  });

  test("Choose per selector… splits ownership across the set", async ({ page }) => {
    await seedProject(page, { project: twoWayCollision() });
    const sheet = new SheetPage(page);
    const console_ = new ConsolePage(page);
    const dialog = new ChoosePerSelectorDialogPage(page);
    const note = await sheet.revealNote(COLLISION_CAPTION);

    await sheet.choosePerSelectorButton(note).click();
    await dialog.expectOpen();
    await dialog.chooseOwner(SEND_MESSAGE, "AxelarGatewayAdapter");
    await dialog.chooseOwner(SUPPORTS_ATTRIBUTE, "HyperlaneGatewayAdapter");
    await dialog.applyOwners().click();

    await expect(dialog.root).toHaveCount(0);
    // Splitting ownership resolves two separate SEL-01s, each to a different owner: one Resolved line per
    // owner (spec L713's grouping), not the dialog's own "Chose owners for n selectors" fallback summary,
    // which only shows when narrating the routing change produces nothing (`edit`'s fallback, S1).
    await expect(console_.line("Resolved: sendMessage · 0xcdfe7f5c routes to AxelarGatewayAdapter.")).toBeVisible();
    await expect(console_.line("Resolved: supportsAttribute · 0xdc680a0f routes to HyperlaneGatewayAdapter.")).toBeVisible();
    await expect(sheet.pinLike("AxelarGatewayAdapter", `${SEND_MESSAGE} ${SEND_MESSAGE_HEX}, routes here`)).toBeVisible();
    await sheet.expandCard("HyperlaneGatewayAdapter");
    await expect(
      sheet.pinLike("HyperlaneGatewayAdapter", `${SUPPORTS_ATTRIBUTE} ${SUPPORTS_ATTRIBUTE_HEX}, routes here`),
    ).toBeVisible();
  });

  test("3+ contenders become one Owner menu @smoke", async ({ page }) => {
    await seedProject(page, { project: threeWayCollision() });
    const sheet = new SheetPage(page);
    const console_ = new ConsolePage(page);
    const note = await sheet.revealNote(COLLISION_CAPTION);

    await expect(sheet.keepButton(note, "AxelarGatewayAdapter")).toHaveCount(0);
    const trigger = sheet.ownerMenuTrigger(note);
    await expect(trigger).toHaveText(/^Owner: AxelarGatewayAdapter/);
    await sheet.chooseOwnerFromMenu(note, "HyperlaneGatewayAdapter");

    await expect(
      console_.line("Resolved: sendMessage · 0xcdfe7f5c and supportsAttribute · 0xdc680a0f route to HyperlaneGatewayAdapter."),
    ).toBeVisible();
  });

  test("Deploy enables once no blockers remain", async ({ page }) => {
    await seedProject(page, { project: cleanCollision() });
    const sheet = new SheetPage(page);
    await sheet.fit();
    await expect(sheet.deployButton()).toBeDisabled();

    await sheet.keepButton(sheet.note("Selector collision · 2"), "Governor").click();

    await expect(sheet.deployButton()).toBeEnabled();
  });

  test("a resolved project's Deploy is already enabled", async ({ page }) => {
    await seedProject(page, { project: cleanCollisionResolved() });
    const sheet = new SheetPage(page);
    await sheet.fit();
    await expect(sheet.deployButton()).toBeEnabled();
  });

  test.describe("seams aren't collisions (spec L441-L442)", () => {
    test("a seam pin offers no route", async ({ page }) => {
      await seedProject(page, { project: seamRecipe() });
      const sheet = new SheetPage(page);
      await sheet.fit();
      const pin = sheet.pinLike(
        "ERC20Pausable",
        "transfer(address,uint256) 0xa9059cbb, seam: stays on GovernedVault",
      );
      await expect(pin).toBeVisible();
      await expect(pin).toHaveAttribute("aria-disabled", "true");
      await expect(pin).toHaveAccessibleDescription(
        "Seam: stays on GovernedVault because its version updates vote checkpoints.",
      );
      // Catalog's own overlay reason ("updates vote checkpoints"), not the spec prose's paraphrase ("moves
      // vote checkpoints", L441/L453): see the WP-Q1b report's Interpretations.

      const structure = new StructurePage(page);
      await structure.open();
      await expect(
        structure.problem(/^Warning: ERC20Pausable cuts nothing: both its selectors are seams that GovernedVault serves\. Remove it\.$/),
      ).toBeVisible();
    });

    test("an owner set before the seam applied blocks with SEM-01's two fixes", async ({ page }) => {
      await seedProject(page, { project: seamOverrideRecipe() });
      const sheet = new SheetPage(page);
      await sheet.fit();
      const note = sheet.note("Seam");
      await expect(note).toBeVisible();
      await expect(note).toContainText(
        "transfer(address,uint256) must be served by a version that updates vote checkpoints (GovernedVault or ERC20Votes), not ERC20Pausable.",
      );
      await expect(sheet.fixButton(note, "Route to GovernedVault")).toBeVisible();
      await expect(sheet.fixButton(note, "Remove ERC20Pausable")).toBeVisible();
    });
  });

  test.describe("keyboard-only", () => {
    test("F8 to the note, then the Structure tree's Problems branch to it again @smoke", async ({ page }) => {
      await seedProject(page, { project: twoWayCollision() });
      const sheet = new SheetPage(page);
      const console_ = new ConsolePage(page);
      const structure = new StructurePage(page);
      const status = page.getByRole("status");
      // A fresh page needs its first paint settled before a global shortcut is guaranteed wired up.
      await expect(sheet.card("AxelarGatewayAdapter")).toBeVisible();

      // F8 focuses the note directly (both problems share it), so the status region says nothing on the
      // first press. A second F8 lands on the pair's other problem, on the same note: focus doesn't move, so
      // the note announces which one this is instead (Note.tsx).
      await page.keyboard.press("F8");
      const note = sheet.note(COLLISION_CAPTION);
      await expect(note).toBeFocused();

      await page.keyboard.press("F8");
      await expect(note).toBeFocused();
      // The status region announces the problem's raw message (backticks included, spec's own quoting): unlike
      // the console log line, nothing here renders `code` spans to strip them (Note.tsx's "already" branch).
      await expect(status).toContainText(
        "`supportsAttribute(bytes4)` 0xdc680a0f is exported by AxelarGatewayAdapter and HyperlaneGatewayAdapter. Choose one owner.",
      );

      // The Structure tree's Problems branch (IR "Left pane": "Enter focuses its note, as F8 does") reaches
      // the same note a fifth way.
      await structure.open();
      await structure
        .problem("Blocker: sendMessage(bytes,bytes,bytes[]) 0xcdfe7f5c is exported by AxelarGatewayAdapter and HyperlaneGatewayAdapter. Choose one owner.")
        .focus();
      await page.keyboard.press("Enter");
      await expect(note).toBeFocused();

      // Tab from the note to its first button ("Keep {A}", two contenders) and resolve it.
      await page.keyboard.press("Tab");
      const keep = sheet.keepButton(note, "AxelarGatewayAdapter");
      await expect(keep).toBeFocused();
      await page.keyboard.press("Enter");

      await expect(
        console_.line("Resolved: sendMessage · 0xcdfe7f5c and supportsAttribute · 0xdc680a0f route to AxelarGatewayAdapter."),
      ).toBeVisible();
    });

    test("Resolve collision… (palette) reopens the note with its choice already open", async ({ page }) => {
      await seedProject(page, { project: twoWayCollision() });
      const sheet = new SheetPage(page);
      const console_ = new ConsolePage(page);
      await expect(sheet.card("AxelarGatewayAdapter")).toBeVisible();

      // Resolve collision… (a sixth way in, spec L436) opens the first unresolved collision's note with its
      // choice already focused: the first button ("Keep {A}", two contenders).
      await runInPalette(page, "Resolve collision…");
      const note = sheet.note(COLLISION_CAPTION);
      const keep = sheet.keepButton(note, "AxelarGatewayAdapter");
      await expect(keep).toBeFocused();
      await page.keyboard.press("Enter");

      await expect(
        console_.line("Resolved: sendMessage · 0xcdfe7f5c and supportsAttribute · 0xdc680a0f route to AxelarGatewayAdapter."),
      ).toBeVisible();
    });

    test("console route verb resolves one selector, the note stays for the other", async ({ page }) => {
      await seedProject(page, { project: twoWayCollision() });
      const sheet = new SheetPage(page);
      await sheet.fit();
      const console_ = new ConsolePage(page);

      await console_.run("route axelargatewayadapter sendMessage");

      await expect(console_.line("Resolved: sendMessage · 0xcdfe7f5c routes to AxelarGatewayAdapter.")).toBeVisible();
      await expect(sheet.note("Selector collision")).toBeVisible(); // one selector left, no count (L50)
      await expect(sheet.note(COLLISION_CAPTION)).toHaveCount(0);
    });
  });

  test.describe("reduced motion", () => {
    test.use({ reducedMotion: "reduce" });

    test("the note fades out at once", async ({ page }) => {
      await seedProject(page, { project: twoWayCollision() });
      const sheet = new SheetPage(page);
      const note = await sheet.revealNote(COLLISION_CAPTION);
      await sheet.keepButton(note, "AxelarGatewayAdapter").click();
      await expect(note).toHaveCount(0);
    });
  });

  test.describe("at 768 px (narrow: the panes become overlay toggles)", () => {
    test.use({ viewport: viewportAt(768) });

    test("the note and its buttons still work", async ({ page }) => {
      await seedProject(page, { project: twoWayCollision() });
      const sheet = new SheetPage(page);
      const console_ = new ConsolePage(page);
      await expectTier(page, "narrow");

      const note = await sheet.revealNote(COLLISION_CAPTION); // notes stay on the sheet at every width (IR "Sheet")
      await sheet.routeButton(note, "HyperlaneGatewayAdapter").click();

      // F8's own selection change opens the inspector overlay at this width, which (one drawer at a time)
      // closes the console: reopen it, as a returning visitor at this width would, before reading the log.
      const expandConsole = page.getByRole("button", { name: "Expand console" });
      if (await expandConsole.isVisible()) await expandConsole.click();

      await expect(
        console_.line("Resolved: sendMessage · 0xcdfe7f5c and supportsAttribute · 0xdc680a0f route to HyperlaneGatewayAdapter."),
      ).toBeVisible();
    });
  });

  test.describe("at 375 px (phone: Sheet, Structure, Catalog, Inspector, Console as tabs)", () => {
    test.use({ viewport: viewportAt(375) });

    test("the note and its buttons still work from the Sheet tab", async ({ page }) => {
      await seedProject(page, { project: twoWayCollision() });
      const sheet = new SheetPage(page);
      const console_ = new ConsolePage(page);
      await expectTier(page, "phone");

      // The pane switcher (IR "Layout controls") starts on Sheet; F8 at this tier can switch it to Inspector to
      // show the problem, which would unmount the note along with the rest of the Sheet pane, so this reaches
      // the note directly rather than through F8's reveal (a real user opens the same note here, since it's
      // already the pane in view at the start of a first visit or a returning one).
      await page.getByRole("tab", { name: "Sheet" }).click();
      await sheet.fit();
      const note = sheet.note(COLLISION_CAPTION);
      await expect(note).toBeVisible();
      await sheet.routeButton(note, "HyperlaneGatewayAdapter").click();

      await page.getByRole("tab", { name: "Console" }).click();
      await expect(
        console_.line("Resolved: sendMessage · 0xcdfe7f5c and supportsAttribute · 0xdc680a0f route to HyperlaneGatewayAdapter."),
      ).toBeVisible();
    });
  });

});
