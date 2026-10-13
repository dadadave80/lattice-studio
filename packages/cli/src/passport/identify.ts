import type { Address, Catalog, Hex } from "@lattice-studio/core";
import type { IdentifiedFacet, LoupeFacet } from "./types";

/**
 * Names each facet by its runtime code hash against every bundled catalog's facet releases. The diamond's own address
 * (functions built into the proxy) is "self"; a facet no catalog knows is "unknown".
 */
export function identifyFacets(
  loupe: readonly LoupeFacet[],
  codehashes: Readonly<Record<string, Hex>>,
  catalogs: readonly Catalog[],
  diamond: Address,
): IdentifiedFacet[] {
  const releases = new Map<string, { name: string; version: string; catalog: string }>();
  for (const catalog of catalogs) {
    for (const facet of catalog.facets) {
      const key = facet.release.codehash.toLowerCase();
      if (!releases.has(key)) releases.set(key, { name: facet.name, version: facet.release.version, catalog: catalog.lattice.tag });
    }
  }
  return loupe.map((row): IdentifiedFacet => {
    const selectors = row.selectors.map((selector) => selector.toLowerCase() as Hex);
    if (row.address.toLowerCase() === diamond.toLowerCase()) {
      return { address: row.address, codehash: null, selectors, kind: "self", name: null, version: null, catalog: null };
    }
    const codehash = codehashes[row.address.toLowerCase()] ?? null;
    const found = codehash === null ? undefined : releases.get(codehash.toLowerCase());
    if (found === undefined) return { address: row.address, codehash, selectors, kind: "unknown", name: null, version: null, catalog: null };
    return { address: row.address, codehash, selectors, kind: "known", name: found.name, version: found.version, catalog: found.catalog };
  });
}
