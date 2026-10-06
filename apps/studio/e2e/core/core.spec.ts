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
import { collisionsProject, recipeProject } from "../_support/projects.ts";
import { openEmpty, seedProject, seedSettings } from "../_support/seed.ts";
import { CatalogPage } from "../q1a/pages/catalog-page.ts";
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

/** The core cell: an APG toolbar named "Core", docked beside the title block. */
function cell(page: Page): Locator {
  return region(page, "Sheet").getByRole("toolbar", { name: "Core", exact: true });
}

/** A card's ground glyph: "9 ⏚", "7/9 ⏚", "0/3 ✕". */
function ground(page: Page, facet: string): Locator {
  return region(page, "Sheet").locator(`.react-flow__node[data-id="${facet}"] [data-ground]`);
}

function traces(page: Page): Locator {
  return page.locator("[data-core-traces] [data-trace]");
}

async function box(locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> {
  const found = await locator.boundingBox();
  if (!found) throw new Error("No box.");
  return found;
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
    await expect(log.line(new RegExp(`Core: fallback ${coreSelectors()} routed · loupe 4/4 · ERC-165 IDiamondLoupe · cut Empty · no upgrade mechanism\\.`))).toBeVisible();
    await expect(region(page, "Inspector").getByRole("heading", { level: 2, name: CORE_TITLE })).toBeVisible();
  });

  test("the core cell sits beside the title block on an empty sheet, covered, with its hint", async ({ page }) => {
    await openEmpty(page);
    const core = cell(page);
    await expect(core.getByRole("button", { name: `Fallback ${coreSelectors()} routed` })).toBeVisible();
    await expect(core.getByRole("button", { name: "Loupe 4/4, 4 of 4 covered" })).toBeVisible();
    await expect(core.getByRole("button", { name: "ERC-165, covered" })).toBeVisible();
    await expect(core.getByText("Facets you place plug in here. Their selectors are the wires.")).toBeVisible();
    const [own, title] = await Promise.all([box(core), box(region(page, "Sheet").getByRole("region", { name: "Title block" }))]);
    expect(own.x + own.width).toBeLessThanOrEqual(title.x);
    expect(Math.abs(own.y + own.height - (title.y + title.height))).toBeLessThanOrEqual(4);
  });

  test("a placed card wears a ground glyph with its routed count, and its live trace runs into the core", async ({ page }) => {
    await openEmpty(page);
    await runConsole(page, "place ERC20");
    await expect(ground(page, "ERC20")).toHaveAttribute("data-ground", "routed");
    await expect(ground(page, "ERC20")).toHaveAttribute("data-ground-count", String(selectorsOf("ERC20")));
    // Placing selects the card: its trace is live and ends on the FALLBACK pad.
    await expect(traces(page).and(page.locator('[data-trace="ERC20"]'))).toHaveAttribute("data-tone", "live");
    await expect(page.locator('[data-trace="ERC20"]')).toHaveAttribute("data-to", "fallback");
    await expect(cell(page).getByText("Facets you place plug in here. Their selectors are the wires.")).toHaveCount(0);
  });

  test("a recipe load flashes the new cards' traces, then lets them go", async ({ page }) => {
    await openEmpty(page);
    // The flash lasts 1.6 s: watch for it from before the click, so a busy machine can't poll past it.
    await page.evaluate(() => {
      const w = window as unknown as { flashSeen?: boolean };
      w.flashSeen = false;
      const seen = () => {
        if (document.querySelector('[data-core-traces] [data-tone="flash"]')) w.flashSeen = true;
      };
      new MutationObserver(seen).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-tone"] });
    });
    await region(page, "Sheet").getByRole("button", { name: /^ERC20 / }).click();
    await expect(sheetCards(page)).toHaveCount(2);
    await expect.poll(() => page.evaluate(() => (window as unknown as { flashSeen?: boolean }).flashSeen)).toBe(true);
    await expect(page.locator('[data-core-traces] [data-tone="flash"]')).toHaveCount(0, { timeout: 5000 });
  });

  test("routing a contested facet completes its glyph", async ({ page }) => {
    await seedProject(page, { project: twoWayCollision() });
    await expect(ground(page, "HyperlaneGatewayAdapter")).toHaveAttribute("data-ground", "partial");
    await runConsole(page, "route HyperlaneGatewayAdapter");
    await expect(ground(page, "HyperlaneGatewayAdapter")).toHaveAttribute("data-ground", "routed");
    await expect(ground(page, "AxelarGatewayAdapter")).toHaveAttribute("data-ground", "partial");
  });

  test("clicking the cell selects the core: the Diamond view names it and every card shows its place in the cut", async ({ page }) => {
    await seedProject(page, { project: recipeProject("ERC20") });
    await expect(sheetCards(page)).toHaveCount(2);
    await cell(page).getByRole("button", { name: "Core The diamond's fixed part" }).click();
    await expect(region(page, "Inspector").getByRole("heading", { level: 2, name: CORE_TITLE })).toBeVisible();
    // The core's two cuts are [00] and [01]; the cards follow in catalog order.
    const stamps = region(page, "Sheet").locator(".react-flow__node [data-stamp]");
    await expect(stamps).toHaveCount(2);
    expect((await stamps.evaluateAll((els) => els.map((el) => el.getAttribute("data-stamp")))).sort()).toEqual(["02", "03"]);
    await region(page, "Sheet").focus();
    await page.keyboard.press("Escape");
    await expect(stamps).toHaveCount(0);
  });

  test("a catalog row dropped on the core cell is refused: nothing is placed, and the console says why", async ({ page }) => {
    await openEmpty(page);
    const sheet = region(page, "Sheet");
    await expect(sheet.locator('.react-flow[data-drop-target="ready"]')).toBeVisible();
    const own = await box(cell(page));
    await new CatalogPage(page).dragRowToSheet("ERC20", { x: own.x + own.width / 2, y: own.y + own.height / 2 });
    await expect(new ConsolePage(page).line(/The core takes no cards\. Drop on the sheet\./)).toBeVisible();
    await expect(sheetCards(page)).toHaveCount(0);
  });

  test("tidy and Fit move the cards, never the core cell", async ({ page }) => {
    await seedProject(page, { project: collisionsProject(12) });
    const before = await box(cell(page));
    await runConsole(page, "tidy");
    await region(page, "Sheet").getByRole("toolbar", { name: "Sheet tools" }).getByRole("button", { name: "Fit" }).click();
    await expect.poll(async () => JSON.stringify(await box(cell(page)))).toBe(JSON.stringify(before));
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
