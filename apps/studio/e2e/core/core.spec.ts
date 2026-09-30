/**
 * The pinned diamond core: the proxy's fallback, DiamondLoupeFacet and ERC165Facet are part of every diamond, never
 * cards. A first visit shows the core alone; placing, removing and routing move its counts; the core can't be
 * removed or placed; it can be selected (palette, console) and Esc lets it go; the header carries the brand mark in
 * both themes. Counts are derived from the real catalog, not hard-coded.
 */
import { CORE_FACETS, isCoreFacet } from "@lattice-studio/core";
import type { Locator, Page } from "@playwright/test";
import { catalog } from "../_support/catalog.ts";
import { expect, test } from "../_support/fixtures.ts";
import { region, runConsole, runInPalette } from "../_support/keys.ts";
import { openEmpty, seedProject, seedSettings } from "../_support/seed.ts";
import { twoWayCollision } from "../q1b/fixtures.ts";
import { ConsolePage } from "../q1b/pages/console-page.ts";

const CORE_TITLE = "Core · the diamond's fixed part";

/** The core's own selectors: the loupe's four and `supportsInterface`. */
function coreSelectors(): number {
  return catalog()
    .facets.filter((facet) => isCoreFacet(facet.name))
    .reduce((sum, facet) => sum + facet.selectors.length, 0);
}

function selectorsOf(name: string): number {
  const facet = catalog().facets.find((f) => f.name === name);
  if (!facet) throw new Error(`${name} isn't in the catalog.`);
  return facet.selectors.length;
}

/** The Diamond view's Core section, as the inspector shows it with nothing selected (or the core selected). */
function coreSection(page: Page): Locator {
  return region(page, "Inspector").getByRole("region", { name: "Core", exact: true });
}

/** The Core section's Fallback row: "{routed} routed · {exported} exported · {excluded} excluded". */
async function routed(page: Page): Promise<number> {
  const text = (await coreSection(page).getByText(/^\d+ routed · \d+ exported · \d+ excluded$/).textContent()) ?? "";
  return Number.parseInt(text, 10);
}

/** The catalog's "n on sheet" counts, summed over its area folders: the recipe's facets, the core's two included. */
async function catalogOnSheet(page: Page): Promise<number> {
  const counts = await region(page, "Left pane").getByText(/^\d+ on sheet$/).allTextContents();
  return counts.reduce((sum, text) => sum + Number.parseInt(text, 10), 0);
}

function sheetCards(page: Page): Locator {
  return region(page, "Sheet").getByRole("group", { name: / \d+ selectors?/ });
}

test.describe("The pinned diamond core", () => {
  test("a first visit shows the core alone: no cards, the core's selectors routed, its two cuts first", async ({ page }) => {
    await openEmpty(page);
    await expect(sheetCards(page)).toHaveCount(0);
    await expect.poll(() => catalogOnSheet(page)).toBe(CORE_FACETS.length);
    await expect.poll(() => routed(page)).toBe(coreSelectors());
    const cuts = region(page, "Inspector").getByRole("list", { name: "Cuts in order" }).getByRole("listitem");
    await expect(cuts).toHaveCount(CORE_FACETS.length);
    await expect(cuts.nth(0)).toContainText("DiamondLoupeFacet");
    await expect(cuts.nth(1)).toContainText("ERC165Facet");
    await expect(region(page, "Inspector").getByText(`${CORE_FACETS.length} · core first`)).toBeVisible();
  });

  test("placing and removing a facet moves the fallback's count; the core stays", async ({ page }) => {
    await openEmpty(page);
    const log = new ConsolePage(page);
    await expect.poll(() => routed(page)).toBe(coreSelectors());
    await log.run("place ERC20");
    await expect(sheetCards(page)).toHaveCount(1);
    // Placing selects the card, so the inspector shows it; selecting the core brings the Core section back.
    await log.run("core");
    await expect.poll(() => routed(page)).toBe(coreSelectors() + selectorsOf("ERC20"));
    await log.run("remove ERC20");
    await expect(sheetCards(page)).toHaveCount(0);
    await expect.poll(() => routed(page)).toBe(coreSelectors());
    await expect.poll(() => catalogOnSheet(page)).toBe(CORE_FACETS.length);
  });

  test("routing a contested facet routes its selectors to the diamond", async ({ page }) => {
    const project = twoWayCollision();
    await seedProject(page, { project });
    await expect(sheetCards(page)).toHaveCount(project.recipe.facets.filter((name) => !isCoreFacet(name)).length);
    const before = await routed(page);
    await runConsole(page, "route HyperlaneGatewayAdapter");
    // The pair contests two selectors: routing Hyperlane gives them an owner, so the fallback routes both.
    await expect.poll(() => routed(page)).toBe(before + 2);
  });

  test("the core can't be removed, and placing one of its facets selects the core instead", async ({ page }) => {
    await openEmpty(page);
    const log = new ConsolePage(page);
    await log.run("remove DiamondLoupeFacet");
    await expect(log.line(/DiamondLoupeFacet is the diamond's core and stays/)).toBeVisible();
    await expect.poll(() => catalogOnSheet(page)).toBe(CORE_FACETS.length);
    await log.run("place ERC165Facet");
    await expect(log.line(/ERC165Facet is part of every diamond's core\./)).toBeVisible();
    await expect(sheetCards(page)).toHaveCount(0);
    await expect(region(page, "Inspector").getByRole("heading", { level: 2, name: CORE_TITLE })).toBeVisible();
  });

  test("Select the core from the palette; Esc lets it go", async ({ page }) => {
    await openEmpty(page);
    const title = region(page, "Inspector").getByRole("heading", { level: 2 }).first();
    await expect(title).toHaveText("Untitled");
    await runInPalette(page, "Select the core");
    await expect(title).toHaveText(CORE_TITLE);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // The sheet itself, not a Start block button: those are tooltip triggers, and a tooltip takes the first Esc.
    await region(page, "Sheet").focus();
    await page.keyboard.press("Escape");
    await expect(title).toHaveText("Untitled");
  });

  test("the console's core verb prints the core's readout", async ({ page }) => {
    await openEmpty(page);
    const log = new ConsolePage(page);
    await log.run("core");
    await expect(log.line(new RegExp(`Core: fallback ${coreSelectors()} routed · loupe 4/4 · ERC-165 IDiamondLoupe · cut none`))).toBeVisible();
    await expect(region(page, "Inspector").getByRole("heading", { level: 2, name: CORE_TITLE })).toBeVisible();
  });

  for (const theme of ["dark", "light"] as const) {
    test(`the header carries the brand mark in the ${theme} theme, and it still opens the App menu`, async ({ page, context }) => {
      await seedSettings(context, { theme });
      await openEmpty(page);
      const brand = region(page, "Title bar").getByRole("button", { name: "Lattice Studio", exact: true });
      const mark = brand.locator("svg[data-logomark]");
      await expect(mark).toHaveAttribute("aria-hidden", "true");
      const [stroke, ink] = await Promise.all([
        mark.evaluate((el) => getComputedStyle(el).color),
        brand.evaluate((el) => getComputedStyle(el).color),
      ]);
      expect(stroke).toBe(ink);
      await brand.click();
      await expect(page.getByRole("menu", { name: "App menu" })).toBeVisible();
    });
  }
});
