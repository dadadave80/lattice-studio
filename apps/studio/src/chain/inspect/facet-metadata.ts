import type { Catalog, Facet, PassportIdentifiedFacet } from "@lattice-studio/core";

export function facetTitle(facet: PassportIdentifiedFacet): string {
  return facet.kind === "known" ? facet.name ?? "Known facet" : facet.kind === "self" ? "Diamond itself" : "Unknown facet";
}

/** A name alone cannot authenticate a catalog release. */
export function facetMetadata(facet: PassportIdentifiedFacet, catalogs: readonly Catalog[]): Facet | undefined {
  if (facet.kind !== "known" || facet.codehash === null) return undefined;
  return catalogs.filter((catalog) => catalog.lattice.tag === facet.catalog).flatMap((catalog) => catalog.facets).find((item) =>
    item.name === facet.name && item.release.version === facet.version && item.release.codehash.toLowerCase() === facet.codehash?.toLowerCase());
}
