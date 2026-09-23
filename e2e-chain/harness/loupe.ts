/** A diamond's `facets()` read from the node, compared with the plan through C5a's `comparePlan` (per facet, as sets). */
import { parseAbi, type Address } from "viem";
import { comparePlan, type LoupeFacet, type PlanComparison, type PlanEntry } from "@lattice-studio/core";
import type { Node } from "./node";

const LOUPE_ABI = parseAbi(["function facets() view returns ((address facetAddress, bytes4[] functionSelectors)[])"]);

export async function readFacets(node: Node, diamond: Address): Promise<readonly LoupeFacet[]> {
  return node.client.readContract({ address: diamond, abi: LOUPE_ABI, functionName: "facets" });
}

export async function compareLoupe(node: Node, diamond: Address, plan: readonly PlanEntry[]): Promise<PlanComparison> {
  return comparePlan(plan, await readFacets(node, diamond));
}

/** "14 facets, 120 selectors", for the result tables. */
export function loupeSummary(plan: readonly PlanEntry[]): string {
  const selectors = plan.reduce((n, entry) => n + entry.selectors.length, 0);
  return `${plan.length} facets, ${selectors} selectors`;
}
