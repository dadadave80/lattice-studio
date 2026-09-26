/**
 * Provisional: PA L78 lists the Structure tab as not designed yet, even though its shape is visible on
 * `current-catalog-row.png`'s "RECIPE SEGMENT" panel and `former-side-panels.png`'s third panel (area-grouped
 * facets with cut counts). This builds the real `StructurePanel` tree (S5b), not a pixel copy of either mock.
 */
import { loadTemplate, type Recipe } from "@lattice-studio/core";
import { makeProject } from "@lattice-studio/core/testing";
import { beforeAll, describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { fixtureCatalog, renderWithStudio } from "../harness";
import { StructurePanel } from "@/panels/structure/StructurePanel";

function template(name: string): Recipe {
  const loaded = loadTemplate(fixtureCatalog(), name);
  if (!loaded.ok) throw new Error(loaded.error);
  return loaded.value;
}

const row = (id: string): HTMLElement => {
  const el = document.querySelector<HTMLElement>(`[data-tree-id="${CSS.escape(id)}"]`);
  if (!el) throw new Error(`No row ${id}`);
  return el;
};

beforeAll(async () => {
  await Promise.all(
    ['400 13px "JetBrains Mono"', '600 13px "JetBrains Mono"', '400 14px Inter', '600 14px Inter', '600 12px Inter'].map(
      (font) => document.fonts.load(font),
    ),
  );
});

async function renderTree(theme: "shop" | "draft") {
  const project = makeProject({ recipe: template("GovernedVault") });
  await renderWithStudio(
    <div style={{ width: 320, height: 560 }}>
      <StructurePanel />
    </div>,
    { project, theme, settings: { reduceMotion: "on" } },
  );
  const tree = page.getByRole("tree", { name: "Structure" });
  await expect.element(tree).toBeVisible();
  return tree;
}

describe.each(["shop", "draft"] as const)("provisional: structure tab (%s)", (theme) => {
  test("provisional-structure-tab-nothing-selected", async () => {
    const tree = await renderTree(theme);
    await expect.element(page.getByRole("treeitem", { name: "ERC20, 9 selectors, 4 served by other facets" })).toBeVisible();
    await document.fonts.ready;
    await expect
      .element(page.elementLocator(tree.element() as HTMLElement))
      .toMatchScreenshot(`provisional-structure-tab-nothing-selected-${theme}`);
  });

  test("provisional-structure-tab-facet-selected", async () => {
    const tree = await renderTree(theme);
    const vaultCore = row("facet:VaultCore");
    await page.elementLocator(vaultCore).click();
    vaultCore.focus();
    await userEvent.keyboard("{ArrowRight}");
    await document.fonts.ready;
    await expect
      .element(page.elementLocator(tree.element() as HTMLElement))
      .toMatchScreenshot(`provisional-structure-tab-facet-selected-${theme}`);
  });
});
