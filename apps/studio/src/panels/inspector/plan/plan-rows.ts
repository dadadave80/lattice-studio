/**
 * The cut plan footer's rows (IR L126): `[00] ADD name`, the facet's address, routed/total selectors, and ⟂
 * while one of its selectors is still contested (no owner yet).
 */
import type { Address, Analysis, Catalog, PlanEntry } from "@lattice-studio/core";
import { formatCount, formatCutIndex } from "@lattice-studio/core";

export type PlanRow = {
  /** "[00]". */
  index: string;
  facet: string;
  address: Address;
  routed: number;
  exported: number;
  /** "5/9 selectors". */
  count: string;
  /** A selector it exports has two or more contenders and no owner. */
  contested: boolean;
};

export function planRows(analysis: Pick<Analysis, "plan" | "routing">, catalog: Catalog | null): PlanRow[] {
  const contestedBy = new Set<string>();
  for (const route of Object.values(analysis.routing)) {
    if (route.owner === undefined && route.contenders.length > 1) for (const name of route.contenders) contestedBy.add(name);
  }
  return analysis.plan.map((entry, index) => {
    const exported = catalog?.facets.find((facet) => facet.name === entry.facet)?.selectors.length ?? entry.selectors.length;
    return {
      index: formatCutIndex(index),
      facet: entry.facet,
      address: entry.address,
      routed: entry.selectors.length,
      exported,
      count: formatCount(entry.selectors.length, exported),
      contested: contestedBy.has(entry.facet),
    };
  });
}

/**
 * Facets on the sheet that route no selector, so the plan cuts no Add for them (PA L9, spec L509, §18 #3c): the
 * footer and Copy plan as JSON say so too, the way every export already does (`buildPlan`'s `omitted`).
 */
export function omittedFacets(plan: readonly Pick<PlanEntry, "facet">[], placed: readonly string[]): string[] {
  const planned = new Set(plan.map((entry) => entry.facet));
  return placed.filter((name) => !planned.has(name));
}
