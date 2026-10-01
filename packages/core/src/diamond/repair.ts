/**
 * The core's two repairs, run wherever a recipe or a layout comes in from outside (parse, `loadRecipe`,
 * `applyLayout`): every recipe carries both core facets, and no layout carries a card for them, since the core
 * is never on the sheet. Helpers beside the API, like `formatParseIssue`; not in API_OWNERS.
 */
import type { Catalog } from "../model/catalog";
import { CORE_FACETS } from "../model/diamond";
import type { Layout } from "../model/layout";
import type { Recipe } from "../model/recipe";

function isCore(name: string): boolean {
  return (CORE_FACETS as readonly string[]).includes(name);
}

/**
 * `recipe` with both core facets: the same object when it already has them. With a catalog, each missing core
 * facet the catalog has goes in at its catalog position among the facets the catalog knows (everything else
 * keeps its order, and a name the catalog lacks is never added); without one, the missing ones are appended.
 */
export function withCore(recipe: Recipe, catalog: Catalog | null): Recipe {
  const present = new Set(recipe.facets);
  const index = catalog === null ? null : new Map(catalog.facets.map((facet, at) => [facet.name, at]));
  const missing = CORE_FACETS.filter((name) => !present.has(name) && (index === null || index.has(name)));
  if (missing.length === 0) return recipe;
  const facets = [...recipe.facets];
  for (const name of missing) {
    const at = index?.get(name);
    // The first facet the catalog places after it; a name the catalog lacks never bounds the insertion.
    const before = at === undefined ? -1 : facets.findIndex((other) => (index?.get(other) ?? -1) > at);
    if (before === -1) facets.push(name);
    else facets.splice(before, 0, name);
  }
  return { ...recipe, facets };
}

/** `layout` without the core's entries: the same object when it has none. */
export function withoutCore(layout: Layout): Layout {
  const names = Object.keys(layout);
  if (!names.some(isCore)) return layout;
  return Object.fromEntries(names.filter((name) => !isCore(name)).map((name) => [name, layout[name]])) as Layout;
}
