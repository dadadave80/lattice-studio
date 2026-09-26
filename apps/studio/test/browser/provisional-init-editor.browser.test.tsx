/**
 * PA L75: "The init plan editor: fields with units, example dots, references shown as 'this diamond (0x…)',
 * From link marks, ↑/↓ reorder, a bundle's locked order, and the init-order legend on the sheet" has no board.
 * Built from the design system and InitEditor.browser.test.tsx's real scenarios (shop only; draft is a token
 * swap with no layout change, so it isn't worth doubling every shot here).
 */
import { beforeAll, describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { session } from "@/contracts";
import { InitEditor } from "@/panels/init/InitEditor";
import { kitchenCatalog, projectFor, SAFE, stepsRecipe, templateRecipe } from "@/panels/init/test-support";
import { fakeChainService, renderWithStudio } from "../harness";

beforeAll(async () => {
  await Promise.all(
    ['400 13px "JetBrains Mono"', '600 13px "JetBrains Mono"', '400 14px Inter', '600 14px Inter', '600 12px Inter'].map(
      (font) => document.fonts.load(font),
    ),
  );
});

function root(): HTMLElement {
  return page.getByRole("region", { name: "Init plan" }).element() as HTMLElement;
}

const vault = () => projectFor(templateRecipe("GovernedVault"));

describe("provisional: init editor fields, their units and example dots (shop)", () => {
  test("GovernedVaultInit's bundle: duration units, an example dot, and the locked order", async () => {
    await renderWithStudio(<InitEditor view={{ kind: "init" }} />, { project: vault() });
    await expect.element(page.getByRole("heading", { name: "GovernedVaultInit" })).toBeVisible();
    await expect.element(page.getByRole("textbox", { name: "Min delay", exact: true })).toBeVisible();
    await expect.element(page.getByRole("combobox", { name: "Min delay unit" })).toBeVisible();
    await expect.element(page.getByRole("textbox", { name: "Name", exact: true })).toHaveAccessibleDescription(/^Example/);
    await document.fonts.ready;
    await expect.element(page.elementLocator(root())).toMatchScreenshot("provisional-init-editor-fields-shop");
  });
});

describe("provisional: a reference field resolved to this diamond (shop)", () => {
  test("SafeDiamondCutInit's Safe: This diamond quick pick shows its own address", async () => {
    const chain = fakeChainService({ account: { address: SAFE, chainId: 11155111, connector: "io.metamask" } });
    await renderWithStudio(<InitEditor view={{ kind: "init" }} />, { project: projectFor(templateRecipe("SafeDiamondCut")), chain });
    session.set({ chainId: 11155111 });
    await page.getByRole("group", { name: "Safe quick picks" }).getByRole("button", { name: "This diamond" }).click();
    await expect.element(page.getByText(/^This diamond \(0x[0-9a-fA-F]{40}\)$/).first()).toBeVisible();
    await document.fonts.ready;
    const field = document.querySelector<HTMLElement>("[data-init-path='steps[0].safe']");
    if (!field) throw new Error("No row for steps[0].safe.");
    await expect.element(page.elementLocator(field)).toMatchScreenshot("provisional-init-editor-reference-shop");
  });
});

describe("provisional: a From link field, unconfirmed (shop)", () => {
  test("SafeDiamondCutInit's Safe, opened from a shared link: the From link mark", async () => {
    const project = projectFor(
      { ...templateRecipe("SafeDiamondCut"), init: { kind: "steps", steps: [{ spec: "SafeDiamondCutInit", args: { admin: { $ref: "deployer" }, safe: SAFE, minThreshold: "2" } }] } },
      { provenance: { "steps[0].safe": "link" } },
    );
    await renderWithStudio(<InitEditor view={{ kind: "init" }} />, { project });
    await expect.element(page.getByText("From link")).toBeVisible();
    await document.fonts.ready;
    const field = document.querySelector<HTMLElement>("[data-init-path='steps[0].safe']");
    if (!field) throw new Error("No row for steps[0].safe.");
    await expect.element(page.elementLocator(field)).toMatchScreenshot("provisional-init-editor-from-link-shop");
  });
});

describe("provisional: step-kind ↑/↓ reorder (shop)", () => {
  test("three steps, out of order (INIT-02): ↑/↓ move them, disabled at the ends", async () => {
    const catalog = kitchenCatalog();
    await renderWithStudio(<InitEditor view={{ kind: "init" }} />, { project: projectFor(stepsRecipe(catalog)), catalog });
    await expect.element(page.getByRole("button", { name: "Move PayoutInit up" })).toHaveAttribute("aria-disabled", "true");
    await expect.element(page.getByRole("button", { name: "Move KitchenInit down" })).toHaveAttribute("aria-disabled", "true");
    await document.fonts.ready;
    await expect.element(page.elementLocator(root())).toMatchScreenshot("provisional-init-editor-reorder-shop");
  });
});
