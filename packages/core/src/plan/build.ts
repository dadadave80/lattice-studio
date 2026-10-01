import { isCoreFacet } from "../diamond/core";
import type { PlanEntry } from "../model/analysis";
import type { BuildPlanFn } from "../model/api";
import type { Catalog, Facet } from "../model/catalog";
import { CORE_FACETS } from "../model/diamond";
import { toLowerHex } from "../model/hex";

/** The placed facets in cut order: the core's (in CORE_FACETS order) first, then the rest in catalog order. */
function cutOrder(placed: ReadonlySet<string>, catalog: Catalog): Facet[] {
  const facets = catalog.facets.filter((facet) => placed.has(facet.name));
  const core = CORE_FACETS.flatMap((name) => facets.filter((facet) => facet.name === name));
  return [...core, ...facets.filter((facet) => !isCoreFacet(facet.name))];
}

/**
 * The cut plan (spec L264, PA bugs 2, 3 and 23): one Add per placed facet that routes at least one selector, the
 * core's entries first (DiamondLoupeFacet, then ERC165Facet) and the rest in catalog order, listing exactly the
 * selectors routed to it, in the facet's own order, with the address, codehash and pinned version of its release
 * (spec L855). A facet that routes nothing gets no Add (an empty Add reverts on-chain); it goes to `omitted`, in
 * the same order, so the plan and every export can say what was left out. Excluded selectors never reach the
 * plan, whatever the routing says. Facets the catalog lacks are skipped (parsing refuses them before they get here).
 */
export const buildPlan: BuildPlanFn = (recipe, catalog, routing) => {
  const placed = new Set(recipe.facets);
  const excluded = new Set(recipe.exclude.map(toLowerHex));
  const entries: PlanEntry[] = [];
  const omitted: string[] = [];
  for (const facet of cutOrder(placed, catalog)) {
    const selectors = facet.selectors
      .map((selector) => toLowerHex(selector.hex))
      .filter((hex) => !excluded.has(hex) && routing[hex]?.owner === facet.name);
    if (selectors.length === 0) {
      omitted.push(facet.name);
      continue;
    }
    entries.push({
      facet: facet.name,
      address: facet.release.address,
      codehash: facet.release.codehash,
      version: facet.release.version,
      selectors,
    });
  }
  return { entries, omitted };
};
