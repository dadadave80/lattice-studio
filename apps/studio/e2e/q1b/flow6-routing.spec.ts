/**
 * Flow 6. Route or exclude a selector by hand (spec L451-L455, IR "Sheet" pin row, "Context menus" (Pin),
 * "Left pane" (Structure's selector node), "Console drawer"). Every scenario is built from the real catalog
 * (`fixtures.ts`):
 *
 * - `blankConvention()`'s ERC165Facet exports exactly one selector, `supportsInterface(bytes4)` 0x01ffc9a7: the
 *   exclude/include round trip and SEL-03 ("cuts nothing"). Excluding it also raises CORE-05, a bonus, unrelated
 *   problem this file only checks the presence of.
 * - `twoWayCollision()`'s AxelarGatewayAdapter/HyperlaneGatewayAdapter pair (same as Flow 4): routing one of
 *   their two contested selectors by hand, directly through its pin, not through the collision note.
 * - `seamRecipe()`'s GovernedVault + ERC20Pausable: a live seam over `transfer`, which offers no Route action at
 *   all (spec L441), tested here through the pin's context menu (Flow 4 already covers the tooltip).
 *
 * Console line text (`Left …`, `Brought … back…`, the Note/Resolved lines for SEL-03 and CORE-05) is derived
 * from `recipe-ops.ts` and `narrate.ts`/`problem.ts` reading (see the WP-Q1b report) and re-verified live before
 * being asserted here.
 */
import { expect, test } from "../_support/fixtures.ts";
import { seedProject } from "../_support/seed.ts";
import { expectTier, viewportAt } from "../_support/viewports.ts";
import { ConsolePage } from "./pages/console-page.ts";
import { SheetPage } from "./pages/sheet-page.ts";
import { StructurePage } from "./pages/structure-page.ts";
import { blankConvention, twoWayCollision, seamRecipe } from "./fixtures.ts";

const SUPPORTS_INTERFACE = "supportsInterface(bytes4)";
const SUPPORTS_INTERFACE_HEX = "0x01ffc9a7";
const SEL03_MESSAGE = "ERC165Facet cuts nothing: its only selector is excluded. Remove it.";
const CORE05_MESSAGE = "supportsInterface() won't exist; wallets and explorers can't detect interfaces.";

test.describe("Flow 6: route or exclude a selector by hand", () => {
  test("toggling a routed selector off and back on @smoke", async ({ page }) => {
    await seedProject(page, { project: blankConvention() });
    const sheet = new SheetPage(page);
    await sheet.fit();
    const console_ = new ConsolePage(page);
    const pin = sheet.pinLike("ERC165Facet", new RegExp(`${SUPPORTS_INTERFACE.replace(/[().]/g, "\\$&")} ${SUPPORTS_INTERFACE_HEX},`));

    await expect(sheet.pinLike("ERC165Facet", `${SUPPORTS_INTERFACE} ${SUPPORTS_INTERFACE_HEX}, routes here`)).toBeVisible();
    await expect(pin).toHaveAccessibleDescription(`${SUPPORTS_INTERFACE}: routes here. Click to leave it out of the diamond.`);

    await pin.click();

    await expect(sheet.pinLike("ERC165Facet", `${SUPPORTS_INTERFACE} ${SUPPORTS_INTERFACE_HEX}, not in the diamond`)).toBeVisible();
    await expect(pin).toHaveAccessibleDescription("Not in the diamond. Click to route here.");
    await expect(console_.line(`Left ${SUPPORTS_INTERFACE.replace("(bytes4)", "")} · ${SUPPORTS_INTERFACE_HEX} out of the diamond`)).toBeVisible();
    await expect(console_.line(`Note ${SEL03_MESSAGE}`)).toBeVisible();
    await expect(console_.line(new RegExp(CORE05_MESSAGE.replace(/[().]/g, "\\$&")))).toBeVisible();

    await pin.click();

    await expect(sheet.pinLike("ERC165Facet", `${SUPPORTS_INTERFACE} ${SUPPORTS_INTERFACE_HEX}, routes here`)).toBeVisible();
    await expect(console_.line("Resolved: ERC165Facet cuts nothing: its only selector is excluded.")).toBeVisible();
    await expect(console_.line(`Resolved: ${CORE05_MESSAGE}`)).toBeVisible();
  });

  test("excluding the last routed selector raises SEL-03 as a warning", async ({ page }) => {
    await seedProject(page, { project: blankConvention() });
    const sheet = new SheetPage(page);
    await sheet.fit();
    const structure = new StructurePage(page);

    await sheet.pinLike("ERC165Facet", `${SUPPORTS_INTERFACE} ${SUPPORTS_INTERFACE_HEX}, routes here`).click();

    await structure.open();
    await expect(structure.problem(`Warning: ${SEL03_MESSAGE}`)).toBeVisible();
  });

  test("a contested selector, routed by hand via its pin @smoke", async ({ page }) => {
    await seedProject(page, { project: twoWayCollision() });
    const sheet = new SheetPage(page);
    await sheet.fit();
    const hyperlanePin = sheet.pinLike(
      "HyperlaneGatewayAdapter",
      "sendMessage(bytes,bytes,bytes[]) 0xcdfe7f5c, contested with AxelarGatewayAdapter",
    );
    await sheet.expandCard("HyperlaneGatewayAdapter");
    await expect(hyperlanePin).toHaveAccessibleDescription("Collides with AxelarGatewayAdapter. Click to route here.");

    await hyperlanePin.click();

    await expect(
      sheet.pinLike("HyperlaneGatewayAdapter", "sendMessage(bytes,bytes,bytes[]) 0xcdfe7f5c, routes here"),
    ).toBeVisible();
    await expect(
      sheet.pinLike("AxelarGatewayAdapter", "sendMessage(bytes,bytes,bytes[]) 0xcdfe7f5c, served by HyperlaneGatewayAdapter"),
    ).toBeVisible();
    // Only sendMessage was routed by hand; supportsAttribute is still contested, so the pair's own note becomes
    // the single-selector caption (no count, IR/spec L50), not gone outright.
    await expect(sheet.note("Selector collision · 2")).toHaveCount(0);
    await expect(sheet.note("Selector collision")).toBeVisible();
  });

  test("a seam pin offers no route, via its context menu", async ({ page }) => {
    await seedProject(page, { project: seamRecipe() });
    const sheet = new SheetPage(page);
    await sheet.fit();
    const pin = sheet.pinLike("ERC20Pausable", "transfer(address,uint256) 0xa9059cbb, seam: stays on GovernedVault");

    // A seam pin is `aria-disabled` (no action), which is legitimate — a real right-click still opens the
    // context menu regardless (only left-click/Enter/Space are blocked by the disabled-control pattern), so
    // this bypasses Playwright's actionability check that otherwise treats `aria-disabled` as not clickable.
    await pin.click({ button: "right", force: true });

    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Copy selector" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Copy signature" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Show owner" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Route here" })).toHaveCount(0);
    await expect(menu.getByRole("menuitem", { name: "Leave out of the diamond" })).toHaveCount(0);
    await expect(menu.getByRole("menuitem", { name: "Bring back" })).toHaveCount(0);

    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
  });

  test("pin context menu items match state", async ({ page }) => {
    await seedProject(page, { project: blankConvention() });
    const sheet = new SheetPage(page);
    await sheet.fit();
    const pin = sheet.pinLike("ERC165Facet", new RegExp(`${SUPPORTS_INTERFACE.replace(/[().]/g, "\\$&")} ${SUPPORTS_INTERFACE_HEX},`));

    await pin.click({ button: "right" });
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Leave out of the diamond" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Route here" })).toHaveCount(0);
    await expect(menu.getByRole("menuitem", { name: "Bring back" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);

    await pin.click();
    await expect(sheet.pinLike("ERC165Facet", `${SUPPORTS_INTERFACE} ${SUPPORTS_INTERFACE_HEX}, not in the diamond`)).toBeVisible();

    await pin.click({ button: "right" });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Bring back" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Route here" })).toHaveCount(0);
    await expect(menu.getByRole("menuitem", { name: "Leave out of the diamond" })).toHaveCount(0);
    await page.keyboard.press("Escape");
  });

  test.describe("keyboard-only", () => {
    test("Structure tree: expand a facet, arrow to its selector, Space toggles it", async ({ page }) => {
      await seedProject(page, { project: blankConvention() });
      const sheet = new SheetPage(page);
      await expect(sheet.card("ERC165Facet")).toBeVisible();
      const structure = new StructurePage(page);
      await structure.open();

      const facetNode = structure.facet("ERC165Facet");
      await facetNode.click();
      await page.keyboard.press("ArrowRight");
      const selectorNode = structure.selector(`${SUPPORTS_INTERFACE} ${SUPPORTS_INTERFACE_HEX}, routes here`);
      await expect(selectorNode).toBeVisible();
      await selectorNode.focus();
      await page.keyboard.press(" ");

      await expect(
        structure.selector(`${SUPPORTS_INTERFACE} ${SUPPORTS_INTERFACE_HEX}, not in the diamond`),
      ).toBeVisible();
      await expect(
        sheet.pinLike("ERC165Facet", `${SUPPORTS_INTERFACE} ${SUPPORTS_INTERFACE_HEX}, not in the diamond`),
      ).toBeVisible();

      // Space again brings it back (same row, new state, new accessible name).
      await structure.selector(`${SUPPORTS_INTERFACE} ${SUPPORTS_INTERFACE_HEX}, not in the diamond`).focus();
      await page.keyboard.press(" ");
      await expect(structure.selector(`${SUPPORTS_INTERFACE} ${SUPPORTS_INTERFACE_HEX}, routes here`)).toBeVisible();
    });

    test("console verbs: exclude, include and route, entirely from the command line", async ({ page }) => {
      await seedProject(page, { project: blankConvention() });
      const sheet = new SheetPage(page);
      await sheet.fit();
      const console_ = new ConsolePage(page);

      await console_.run("exclude supportsinterface");
      await expect(
        sheet.pinLike("ERC165Facet", `${SUPPORTS_INTERFACE} ${SUPPORTS_INTERFACE_HEX}, not in the diamond`),
      ).toBeVisible();
      await expect(console_.line(`Left supportsInterface · ${SUPPORTS_INTERFACE_HEX} out of the diamond.`)).toBeVisible();

      await console_.run("include supportsinterface");
      await expect(
        sheet.pinLike("ERC165Facet", `${SUPPORTS_INTERFACE} ${SUPPORTS_INTERFACE_HEX}, routes here`),
      ).toBeVisible();
      await expect(
        console_.line(`Brought supportsInterface · ${SUPPORTS_INTERFACE_HEX} back into the diamond.`),
      ).toBeVisible();
    });

    test("console route verb resolves a contested selector by hand @smoke", async ({ page }) => {
      await seedProject(page, { project: twoWayCollision() });
      const sheet = new SheetPage(page);
      await sheet.fit();
      const console_ = new ConsolePage(page);

      await console_.run("route hyperlanegatewayadapter sendmessage");

      await expect(console_.line("Resolved: sendMessage · 0xcdfe7f5c routes to HyperlaneGatewayAdapter.")).toBeVisible();
      await expect(
        sheet.pinLike("AxelarGatewayAdapter", "sendMessage(bytes,bytes,bytes[]) 0xcdfe7f5c, served by HyperlaneGatewayAdapter"),
      ).toBeVisible();
    });
  });

  test.describe("at 768 px (narrow: the panes become overlay toggles)", () => {
    test.use({ viewport: viewportAt(768) });

    test("the pin toggle still works", async ({ page }) => {
      await seedProject(page, { project: blankConvention() });
      const sheet = new SheetPage(page);
      const console_ = new ConsolePage(page);
      await expectTier(page, "narrow");
      await sheet.fit();

      await sheet.pinLike("ERC165Facet", `${SUPPORTS_INTERFACE} ${SUPPORTS_INTERFACE_HEX}, routes here`).click();

      const expandConsole = page.getByRole("button", { name: "Expand console" });
      if (await expandConsole.isVisible()) await expandConsole.click();
      await expect(console_.line(`Left supportsInterface · ${SUPPORTS_INTERFACE_HEX} out of the diamond.`)).toBeVisible();
      await expect(
        sheet.pinLike("ERC165Facet", `${SUPPORTS_INTERFACE} ${SUPPORTS_INTERFACE_HEX}, not in the diamond`),
      ).toBeVisible();
    });
  });

  test.describe("at 375 px (phone: Sheet, Structure, Catalog, Inspector, Console as tabs)", () => {
    test.use({ viewport: viewportAt(375) });

    test("the pin toggle still works from the Sheet tab", async ({ page }) => {
      await seedProject(page, { project: blankConvention() });
      const sheet = new SheetPage(page);
      const console_ = new ConsolePage(page);
      await expectTier(page, "phone");

      await page.getByRole("tab", { name: "Sheet" }).click();
      await sheet.fit();
      await sheet.pinLike("ERC165Facet", `${SUPPORTS_INTERFACE} ${SUPPORTS_INTERFACE_HEX}, routes here`).click();
      await expect(
        sheet.pinLike("ERC165Facet", `${SUPPORTS_INTERFACE} ${SUPPORTS_INTERFACE_HEX}, not in the diamond`),
      ).toBeVisible();

      await page.getByRole("tab", { name: "Console" }).click();
      await expect(console_.line(`Left supportsInterface · ${SUPPORTS_INTERFACE_HEX} out of the diamond.`)).toBeVisible();
    });
  });
});
