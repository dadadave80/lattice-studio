/**
 * Board: `design/boards/current-catalog-row.png`, the two catalog columns (DRAFT and SHOP). Rest, on sheet
 * (the board's "in cut"), verified and unavailable, in both themes.
 *
 * The board's own facet names (RateLimiter, CircuitBreaker) aren't in the fixture catalog: an "erc20" search
 * narrows to facets we do have (ERC20 and ERC20Votes, placed by GovernedVault; ERC20Pausable left unplaced),
 * so the row states match without matching the mock's names.
 */
import { loadTemplate, type Recipe } from "@lattice-studio/core";
import { makeProject } from "@lattice-studio/core/testing";
import { beforeAll, describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { fakeChainService, fixtureCatalog, healthyChainState, renderWithStudio } from "../harness";
import { CatalogPanel } from "@/panels/catalog/CatalogPanel";

const CHAIN_ID = 11155111;

function template(name: string): Recipe {
  const loaded = loadTemplate(fixtureCatalog(), name);
  if (!loaded.ok) throw new Error(loaded.error);
  return loaded.value;
}

const row = (id: string) => document.querySelector<HTMLElement>(`[data-tree-id="${CSS.escape(id)}"]`);

beforeAll(async () => {
  await Promise.all(
    ['400 13px "JetBrains Mono"', '600 13px "JetBrains Mono"', '400 14px Inter', '600 14px Inter', '600 12px Inter'].map(
      (font) => document.fonts.load(font),
    ),
  );
});

async function renderTokensExpanded(theme: "shop" | "draft") {
  const catalog = fixtureCatalog();
  const healthy = healthyChainState(CHAIN_ID, "Sepolia", catalog);
  const chain = fakeChainService({
    catalog,
    state: { [CHAIN_ID]: { shared: { ...healthy.shared, ERC20Pausable: { present: false } } } },
  });
  await chain.probe(CHAIN_ID);
  const project = makeProject({ recipe: template("GovernedVault") });
  await renderWithStudio(
    <div style={{ width: 320, height: 520 }}>
      <CatalogPanel />
    </div>,
    { catalog, project, theme, session: { chainId: CHAIN_ID }, chain, settings: { reduceMotion: "on" } },
  );
  const search = page.getByRole("textbox", { name: "Search" });
  await userEvent.click(search);
  await userEvent.keyboard("erc20");
  await expect.poll(() => row("ERC20")).not.toBeNull();
  await expect
    .poll(() => row("ERC20")?.querySelector('[aria-label="Code matches the release"]'))
    .not.toBeNull();
  return page.getByRole("tree", { name: "Catalog" });
}

describe.each(["shop", "draft"] as const)("board: catalog row (%s)", (theme) => {
  test("tokens area: on-sheet (ghosted), verified and rest rows", async () => {
    const tree = await renderTokensExpanded(theme);
    expect(row("ERC20")?.textContent).toContain("On sheet");
    expect(row("ERC20Votes")?.textContent).toContain("On sheet");
    expect(row("ERC20Pausable")?.textContent).toContain("Not on Sepolia");
    await document.fonts.ready;
    await expect.element(page.elementLocator(tree.element() as HTMLElement)).toMatchScreenshot(`catalog-row-tokens-${theme}`);
  });

  test("hover on an unplaced row", async () => {
    const tree = await renderTokensExpanded(theme);
    const target = row("ERC20Pausable");
    if (!target) throw new Error("No ERC20Pausable row.");
    await page.elementLocator(target).hover();
    await document.fonts.ready;
    await expect.element(page.elementLocator(tree.element() as HTMLElement)).toMatchScreenshot(`catalog-row-hover-${theme}`);
    await page.elementLocator(document.body).hover();
  });

  test("selected: a click on an unplaced row", async () => {
    const tree = await renderTokensExpanded(theme);
    const target = row("ERC20Pausable");
    if (!target) throw new Error("No ERC20Pausable row.");
    await page.elementLocator(target).click();
    await document.fonts.ready;
    await expect.element(page.elementLocator(tree.element() as HTMLElement)).toMatchScreenshot(`catalog-row-selected-${theme}`);
  });
});
