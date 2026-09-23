/**
 * What routing and the selector checks read from a recipe, computed the same way for both: the placed facets
 * in catalog order, each exported selector's contenders, owners and exclusions keyed lowercase, and the seam
 * that applies to a selector. Internal to C2 (not exported from the analysis barrel).
 */
import type { Catalog, Facet, Seam } from "../model/catalog";
import type { Hex4 } from "../model/hex";
import type { Recipe } from "../model/recipe";

/** `exportSelectors()`: never cut into a diamond (R3, spec L55). */
export const EXPORT_SELECTORS: Hex4 = "0x0ef22643";

/** The signature SEL-04 names; no catalog facet carries it, since catalog-gen strips it. */
export const EXPORT_SELECTORS_SIGNATURE = "exportSelectors()";

export type RecipeView = {
  /** Placed facets the catalog knows, in catalog order (the recipe's own order never matters). */
  placed: Facet[];
  /** Names of `placed`. */
  placedNames: ReadonlySet<string>;
  /** Every selector a placed facet exports (never 0x0ef22643) → its contenders, in catalog order. Keys sorted. */
  contenders: ReadonlyMap<Hex4, string[]>;
  /** `recipe.owners`, keys lowercased. */
  owners: ReadonlyMap<Hex4, string>;
  /** `recipe.exclude`, lowercased. */
  exclude: ReadonlySet<Hex4>;
  /** Catalog position of each facet, for ordering. */
  index: ReadonlyMap<string, number>;
  catalog: Catalog;
};

/** The view of `recipe` against `catalog`. Cheap (one pass over the placed facets), so never cached. */
export function recipeView(recipe: Recipe, catalog: Catalog): RecipeView {
  const wanted = new Set(recipe.facets);
  const placed = catalog.facets.filter((facet) => wanted.has(facet.name));
  const found = new Map<Hex4, string[]>();
  for (const facet of placed) {
    for (const { hex } of facet.selectors) {
      const selector = hex.toLowerCase() as Hex4;
      if (selector === EXPORT_SELECTORS) continue;
      const list = found.get(selector) ?? [];
      if (!list.includes(facet.name)) list.push(facet.name);
      found.set(selector, list);
    }
  }
  const contenders = new Map([...found.keys()].sort().map((selector) => [selector, found.get(selector) ?? []] as const));
  const owners = new Map<Hex4, string>();
  for (const key of Object.keys(recipe.owners).sort()) {
    const owner = recipe.owners[key as Hex4];
    if (owner !== undefined) owners.set(key.toLowerCase() as Hex4, owner);
  }
  return {
    placed,
    placedNames: new Set(placed.map((facet) => facet.name)),
    contenders,
    owners,
    exclude: new Set(recipe.exclude.map((selector) => selector.toLowerCase() as Hex4)),
    index: new Map(catalog.facets.map((facet, at) => [facet.name, at])),
    catalog,
  };
}

/**
 * The seam that governs `selector` on this sheet: the first seam in catalog order for it whose `when` facets
 * are all placed (spec L302). Undefined when none is active.
 */
export function activeSeam(view: RecipeView, selector: Hex4): Seam | undefined {
  return view.catalog.seams.find(
    (seam) => seam.selector.toLowerCase() === selector && seam.when.every((name) => view.placedNames.has(name)),
  );
}

/** The seams active on this sheet, one per selector (the first in catalog order), sorted by selector. */
export function activeSeams(view: RecipeView): Seam[] {
  const seen = new Set<string>();
  const out: Seam[] = [];
  for (const seam of view.catalog.seams) {
    const selector = seam.selector.toLowerCase();
    if (seen.has(selector) || !seam.when.every((name) => view.placedNames.has(name))) continue;
    seen.add(selector);
    out.push(seam);
  }
  return out.sort((a, b) => (a.selector.toLowerCase() < b.selector.toLowerCase() ? -1 : 1));
}

/** The facets of an active seam that can serve `selector` here: allowed, placed and exporting it, in `anyOf` order. */
export function allowedServers(view: RecipeView, seam: Seam, selector: Hex4): string[] {
  const contenders = view.contenders.get(selector) ?? [];
  return seam.anyOf.filter((name) => contenders.includes(name));
}

/** A selector's signature from the first catalog facet that exports it; undefined when none does. */
export function signatureOf(catalog: Catalog, selector: Hex4): string | undefined {
  if (selector === EXPORT_SELECTORS) return EXPORT_SELECTORS_SIGNATURE;
  for (const facet of catalog.facets) {
    const found = facet.selectors.find((s) => s.hex.toLowerCase() === selector);
    if (found !== undefined) return found.signature;
  }
  return undefined;
}

/** Names sorted by catalog position; names the catalog lacks go last, by name. Duplicates dropped. */
export function inCatalogOrder(view: Pick<RecipeView, "index">, names: Iterable<string>): string[] {
  const at = (name: string) => view.index.get(name) ?? Number.POSITIVE_INFINITY;
  return [...new Set(names)].sort((a, b) => at(a) - at(b) || (a < b ? -1 : a > b ? 1 : 0));
}
