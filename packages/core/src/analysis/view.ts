/**
 * What routing and the selector checks read from a recipe, computed the same way for both: the placed facets
 * in catalog order, each exported selector's contenders, owners and exclusions keyed lowercase, and the seam
 * that applies to a selector. Internal to C2 (not exported from the analysis barrel).
 *
 * One analysis builds the view once, however many of routing, the checks and the stats ask for it (spec L301:
 * under 5 ms for 30 facets). Two memos make that so, both keyed by object identity, so nothing here reads a
 * clock or hashes anything:
 * - per catalog, the lookups every view needs (positions, signatures, seams by selector);
 * - per recipe, the view itself, but only for a recipe whose `facets`, `owners` and `exclude` are frozen (as
 *   `analyze` freezes its normalized copy's). A recipe someone can still edit in place always gets a new view.
 * Catalogs are values: nothing in core edits one after loading it.
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
  /** The active seam for each selector that has one (see `activeSeam`), keys sorted. */
  seams: ReadonlyMap<Hex4, Seam>;
  /** `placed` by name (the first, should a name repeat). */
  byName: ReadonlyMap<string, Facet>;
  catalog: Catalog;
};

/** What every view of one catalog shares. */
type CatalogIndex = {
  index: ReadonlyMap<string, number>;
  /**
   * Selector (lowercase) → its signature on the first facet in catalog order that exports it, filled only as
   * far as `signatureOf` has needed: it holds every selector of the facets before `scanned`. An analysis names
   * few signatures, so it rarely reads the whole catalog.
   */
  signatures: Map<Hex4, string>;
  scanned: number;
  /** Selector (lowercase) → its seams, in catalog order. */
  seams: ReadonlyMap<Hex4, readonly Seam[]>;
};

const catalogIndexes = new WeakMap<Catalog, CatalogIndex>();
const views = new WeakMap<Recipe, { catalog: Catalog; view: RecipeView }>();

function catalogIndex(catalog: Catalog): CatalogIndex {
  const known = catalogIndexes.get(catalog);
  if (known !== undefined) return known;
  const index = new Map<string, number>();
  catalog.facets.forEach((facet, at) => index.set(facet.name, at));
  const seams = new Map<Hex4, Seam[]>();
  for (const seam of catalog.seams) {
    const selector = seam.selector.toLowerCase() as Hex4;
    const list = seams.get(selector);
    if (list === undefined) seams.set(selector, [seam]);
    else list.push(seam);
  }
  const built: CatalogIndex = { index, signatures: new Map(), scanned: 0, seams };
  catalogIndexes.set(catalog, built);
  return built;
}

/** Whether `recipe`'s view can be kept: nothing it reads can change in place. */
function settled(recipe: Recipe): boolean {
  return Object.isFrozen(recipe.facets) && Object.isFrozen(recipe.owners) && Object.isFrozen(recipe.exclude);
}

/** The view of `recipe` against `catalog`: kept for a settled recipe (see the module doc), built otherwise. */
export function recipeView(recipe: Recipe, catalog: Catalog): RecipeView {
  const keep = settled(recipe);
  if (keep) {
    const known = views.get(recipe);
    if (known !== undefined && known.catalog === catalog) return known.view;
  }
  const view = buildView(recipe, catalog);
  if (keep) views.set(recipe, { catalog, view });
  return view;
}

function buildView(recipe: Recipe, catalog: Catalog): RecipeView {
  const shared = catalogIndex(catalog);
  const wanted = new Set(recipe.facets);
  const placed = catalog.facets.filter((facet) => wanted.has(facet.name));
  const placedNames = new Set(placed.map((facet) => facet.name));
  const byName = new Map<string, Facet>();
  for (const facet of placed) if (!byName.has(facet.name)) byName.set(facet.name, facet);
  const found = new Map<Hex4, string[]>();
  for (const facet of placed) {
    for (const { hex } of facet.selectors) {
      const selector = hex.toLowerCase() as Hex4;
      if (selector === EXPORT_SELECTORS) continue;
      const list = found.get(selector);
      if (list === undefined) found.set(selector, [facet.name]);
      else if (!list.includes(facet.name)) list.push(facet.name);
    }
  }
  const contenders = new Map<Hex4, string[]>();
  for (const selector of [...found.keys()].sort()) contenders.set(selector, found.get(selector) ?? []);
  const owners = new Map<Hex4, string>();
  for (const key of Object.keys(recipe.owners).sort()) {
    const owner = recipe.owners[key as Hex4];
    if (owner !== undefined) owners.set(key.toLowerCase() as Hex4, owner);
  }
  // The first seam in catalog order whose `when` facets are all placed, per selector (spec L302).
  const seams = new Map<Hex4, Seam>();
  for (const selector of [...shared.seams.keys()].sort()) {
    const active = shared.seams.get(selector)?.find((seam) => seam.when.every((name) => placedNames.has(name)));
    if (active !== undefined) seams.set(selector, active);
  }
  return {
    placed,
    placedNames,
    contenders,
    owners,
    exclude: new Set(recipe.exclude.map((selector) => selector.toLowerCase() as Hex4)),
    index: shared.index,
    seams,
    byName,
    catalog,
  };
}

/**
 * The seam that governs `selector` on this sheet: the first seam in catalog order for it whose `when` facets
 * are all placed (spec L302). Undefined when none is active.
 */
export function activeSeam(view: RecipeView, selector: Hex4): Seam | undefined {
  return view.seams.get(selector);
}

/** The seams active on this sheet, one per selector (the first in catalog order), sorted by selector. */
export function activeSeams(view: RecipeView): Seam[] {
  return [...view.seams.values()];
}

/** The facets of an active seam that can serve `selector` here: allowed, placed and exporting it, in `anyOf` order. */
export function allowedServers(view: RecipeView, seam: Seam, selector: Hex4): string[] {
  const contenders = view.contenders.get(selector) ?? [];
  return seam.anyOf.filter((name) => contenders.includes(name));
}

/** A selector's signature from the first catalog facet that exports it; undefined when none does. */
export function signatureOf(catalog: Catalog, selector: Hex4): string | undefined {
  if (selector === EXPORT_SELECTORS) return EXPORT_SELECTORS_SIGNATURE;
  const shared = catalogIndex(catalog);
  const { signatures } = shared;
  let found = signatures.get(selector);
  while (found === undefined && shared.scanned < catalog.facets.length) {
    for (const { hex, signature } of catalog.facets[shared.scanned]?.selectors ?? []) {
      const key = hex.toLowerCase() as Hex4;
      if (!signatures.has(key)) signatures.set(key, signature);
    }
    shared.scanned += 1;
    found = signatures.get(selector);
  }
  return found;
}

/** Catalog position of each facet: the same map every view of `catalog` holds. */
export function facetIndex(catalog: Catalog): ReadonlyMap<string, number> {
  return catalogIndex(catalog).index;
}

/** Names sorted by catalog position; names the catalog lacks go last, by name. Duplicates dropped. */
export function inCatalogOrder(view: Pick<RecipeView, "index">, names: Iterable<string>): string[] {
  const at = (name: string) => view.index.get(name) ?? Number.POSITIVE_INFINITY;
  return [...new Set(names)].sort((a, b) => at(a) - at(b) || (a < b ? -1 : a > b ? 1 : 0));
}
