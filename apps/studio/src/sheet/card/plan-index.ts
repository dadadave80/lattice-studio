/**
 * A card's place in the cut plan, for the stamp it shows while the core is selected: the core's entries first,
 * then the rest in the plan's own order, so the sheet's numbers agree with the cut plan footer whatever order
 * `analysis.plan` arrives in. Pure; the lookup is built once per plan array.
 */
import type { PlanEntry } from "@lattice-studio/core";
import { isCoreFacet } from "@lattice-studio/core";

const cache = new WeakMap<readonly PlanEntry[], Map<string, number>>();

/** The plan's facets, the core first, each with its index. */
function indexOf(plan: readonly PlanEntry[]): Map<string, number> {
  const cached = cache.get(plan);
  if (cached) return cached;
  const order = [...plan.filter((entry) => isCoreFacet(entry.facet)), ...plan.filter((entry) => !isCoreFacet(entry.facet))];
  const map = new Map<string, number>();
  order.forEach((entry, index) => {
    if (!map.has(entry.facet)) map.set(entry.facet, index);
  });
  cache.set(plan, map);
  return map;
}

/** `facet`'s index in the cut plan (the core first), or null when it isn't cut (it routes nothing). */
export function planIndex(plan: readonly PlanEntry[], facet: string): number | null {
  return indexOf(plan).get(facet) ?? null;
}

/** What the stamp prints: "02", or "Not cut" for a card absent from the plan. */
export function stampText(index: number | null): string {
  return index === null ? "Not cut" : String(index).padStart(2, "0");
}
