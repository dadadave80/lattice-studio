import type { Catalog, Facet } from "../model/catalog";
import type { Recipe } from "../model/recipe";
import { isAddress, toChecksum } from "../model/hex";

/** Metadata-only lookup for UI/command discovery; full recipe/origin safety remains resolveUpgrade's job. */
export function upgradeFacetMetadata(recipe: Recipe, catalog: Catalog, id: string): Facet | undefined {
  if (!id.startsWith("onchain:")) return catalog.facets.find((facet) => facet.name === id);
  if (recipe.mode !== "upgrade" || recipe.catalog.hash.toLowerCase() !== catalog.hash.toLowerCase()) return undefined;
  const instance = recipe.facetInstances?.[id];
  if (instance?.kind !== "known" || !isAddress(instance.address) || /^0x0{40}$/i.test(instance.address)
    || id !== `onchain:${instance.address.toLowerCase()}`) return undefined;
  const facet = catalog.facets.find((entry) => entry.name === instance.catalogFacet && entry.release.codehash.toLowerCase() === instance.codehash.toLowerCase());
  return facet ? { ...facet, name: id, release: { ...facet.release, address: toChecksum(instance.address) } } : undefined;
}
