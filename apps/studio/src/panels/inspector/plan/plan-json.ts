/**
 * Copy plan as JSON (IR L126): the cut plan as `IDiamond.FacetCut`s in cut order, each with the facet's name,
 * pinned version and codehash (spec L855), under the recipe hash it was planned from.
 */
import type { Analysis } from "@lattice-studio/core";

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
};

export function planObject(analysis: Pick<Analysis, "recipeHash" | "plan">): PlanJson {
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
  };
}

/** Two-space indented, with a trailing newline. */
export function planJson(analysis: Pick<Analysis, "recipeHash" | "plan">): string {
  return `${JSON.stringify(planObject(analysis), null, 2)}\n`;
}
