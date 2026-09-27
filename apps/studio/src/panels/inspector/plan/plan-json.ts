/**
 * Copy plan as JSON (IR L126): the cut plan as `IDiamond.FacetCut`s in cut order, each with the facet's name,
 * pinned version and codehash (spec L855), under the recipe hash it was planned from. `omitted` names the
 * placed facets that route nothing, so no Add is cut for them (PA L9, §18 #3c), the way every export does.
 */
import type { Analysis } from "@lattice-studio/core";
import { omittedFacets } from "./plan-rows";

export type PlanJson = {
  recipeHash: string;
  facetCuts: {
    facet: string;
    version: string;
    facetAddress: string;
    codehash: string;
    action: "Add";
    functionSelectors: string[];
  }[];
  omitted: string[];
};

export function planObject(analysis: Pick<Analysis, "recipeHash" | "plan">, placed: readonly string[]): PlanJson {
  return {
    recipeHash: analysis.recipeHash,
    facetCuts: analysis.plan.map((entry) => ({
      facet: entry.facet,
      version: entry.version,
      facetAddress: entry.address,
      codehash: entry.codehash,
      action: "Add",
      functionSelectors: [...entry.selectors],
    })),
    omitted: omittedFacets(analysis.plan, placed),
  };
}

/** Two-space indented, with a trailing newline. */
export function planJson(analysis: Pick<Analysis, "recipeHash" | "plan">, placed: readonly string[]): string {
  return `${JSON.stringify(planObject(analysis, placed), null, 2)}\n`;
}
