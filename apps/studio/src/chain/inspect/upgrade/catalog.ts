import { projectUpgradeCatalog, type Catalog, type Recipe } from "@lattice-studio/core";

const views = new WeakMap<Recipe, WeakMap<Catalog, Catalog | null>>();

/** Projection only: aliases use actual addresses and verified metadata. Raw code is never a fake catalog facet. */
export function compositionCatalog(recipe: Recipe, catalog: Catalog | null): Catalog | null {
  if (catalog === null || recipe.mode !== "upgrade") return catalog;
  let byCatalog = views.get(recipe);
  if (!byCatalog) { byCatalog = new WeakMap(); views.set(recipe, byCatalog); }
  if (byCatalog.has(catalog)) return byCatalog.get(catalog) ?? null;
  const resolved = projectUpgradeCatalog(recipe, catalog);
  const value = resolved.ok ? resolved.value.catalog : null;
  byCatalog.set(catalog, value);
  return value;
}

export function facetDisplayName(recipe: Recipe, name: string): string {
  const instance = recipe.mode === "upgrade" ? recipe.facetInstances?.[name] : undefined;
  return instance?.kind === "known" ? instance.catalogFacet : instance?.kind === "foreign" ? "Foreign facet" : instance?.kind === "self" ? "Diamond itself" : name;
}

/** Catalog shard names remain the verified release's original name, never the internal instance id. */
export function catalogFacetName(recipe: Recipe, name: string): string {
  const instance = recipe.mode === "upgrade" ? recipe.facetInstances?.[name] : undefined;
  return instance?.kind === "known" ? instance.catalogFacet : name;
}
