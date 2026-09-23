import type { PlanEntry } from "../model/analysis";
import type { BuildPlanFn } from "../model/api";
import { toLowerHex } from "../model/hex";

/**
 * The cut plan (spec L264, PA bugs 2, 3 and 23): one Add per placed facet that routes at least one selector, in
 * catalog order, listing exactly the selectors routed to it, in the facet's own order, with the address, codehash
 * and pinned version of its release (spec L855). A facet that routes nothing gets no Add (an empty Add reverts
 * on-chain); it goes to `omitted`, in catalog order, so the plan and every export can say what was left out.
 * Excluded selectors never reach the plan, whatever the routing says. Facets the catalog lacks are skipped
 * (parsing refuses them before they get here).
 */
export const buildPlan: BuildPlanFn = (recipe, catalog, routing) => {
  const placed = new Set(recipe.facets);
  const excluded = new Set(recipe.exclude.map(toLowerHex));
  const entries: PlanEntry[] = [];
  const omitted: string[] = [];
  for (const facet of catalog.facets) {
    if (!placed.has(facet.name)) continue;
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
