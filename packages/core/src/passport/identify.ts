import type { Address, Catalog, Hex } from "../model";
import type { LoupeFacet } from "../model/chain";
import type { PassportIdentifiedFacet } from "./types";

/**
 * Names each facet by its runtime code hash against every bundled catalog's facet releases. The diamond's own address
 * (functions built into the proxy) is "self"; a facet no catalog knows is "unknown".
 */
export function identifyFacets(
  loupe: readonly LoupeFacet[],
  codehashes: Readonly<Record<string, Hex>>,
  catalogs: readonly Catalog[],
  diamond: Address,
): PassportIdentifiedFacet[] {
  const releases = new Map<string, { name: string; version: string; catalog: string }>();
  for (const catalog of catalogs) {
    for (const facet of catalog.facets) {
      const key = facet.release.codehash.toLowerCase();
      if (!releases.has(key)) releases.set(key, { name: facet.name, version: facet.release.version, catalog: catalog.lattice.tag });
    }
  }
  return loupe.map((row): PassportIdentifiedFacet => {
    const selectors = row.functionSelectors.map((selector) => selector.toLowerCase() as Hex);
    if (row.facetAddress.toLowerCase() === diamond.toLowerCase()) {
      return { address: row.facetAddress, codehash: null, selectors, kind: "self", name: null, version: null, catalog: null };
    }
    const codehash = codehashes[row.facetAddress.toLowerCase()] ?? null;
    const found = codehash === null ? undefined : releases.get(codehash.toLowerCase());
    if (found === undefined) return { address: row.facetAddress, codehash, selectors, kind: "unknown", name: null, version: null, catalog: null };
    return { address: row.facetAddress, codehash, selectors, kind: "known", name: found.name, version: found.version, catalog: found.catalog };
  });
}
