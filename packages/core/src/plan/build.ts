import { isCoreFacet } from "../diamond/core";
import type { PlanEntry } from "../model/analysis";
import type { BuildPlanFn } from "../model/api";
import type { Catalog, Facet } from "../model/catalog";
import { CORE_FACETS } from "../model/diamond";
import { toLowerHex } from "../model/hex";
import { projectUpgradeCatalog } from "../upgrade/projection";

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
  const upgrade = recipe.mode === "upgrade" ? projectUpgradeCatalog(recipe, catalog) : undefined;
  if (upgrade !== undefined && !upgrade.ok) throw new Error(upgrade.error);
  if (upgrade?.ok) catalog = upgrade.value.catalog;
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
  for (const row of upgrade?.ok ? upgrade.value.raw : []) {
    const selectors = row.selectors.filter((selector) => !excluded.has(selector) && routing[selector]?.owner === row.id);
    const existing = entries.find((entry) => entry.facet === row.id);
    if (existing) existing.selectors.push(...selectors.filter((selector) => !existing.selectors.includes(selector)));
    else if (selectors.length > 0) entries.push({ facet: row.id, address: row.address, codehash: row.codehash,
      version: row.kind === "extra" ? catalog.facets.find((facet) => facet.name === row.id)?.release.version ?? "unknown" : row.kind === "self" ? "self" : "unknown", selectors });
    if (selectors.length > 0) {
      const omittedAt = omitted.indexOf(row.id);
      if (omittedAt >= 0) omitted.splice(omittedAt, 1);
    } else if (!existing && !omitted.includes(row.id)) omitted.push(row.id);
  }
  return { entries, omitted };
};
