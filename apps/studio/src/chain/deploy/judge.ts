/**
 * Whether a diamond on-chain is the one a record says it is (Flow 12 step 7, spec L501, L857): its `facets()`
 * against the plan per facet as sets (C5a's `comparePlan`), and each planned facet's code against the catalog's
 * codehash as the chain probe read it. Pure.
 *
 * Without a plan (a record this browser wrote for a recipe the sheet has moved on from, whose plan can't be rebuilt)
 * the diamond must be made of catalog releases only: every facet address in `facets()` is a catalog facet's release
 * address, and the code there hashes to that release's codehash. A From file record never takes this path: without a
 * plan it stays unchecked (the machine's `settle`).
 */
import type { Catalog, ChainState, Hex, LoupeFacet, PlanComparison, PlanEntry, SharedContract } from "@lattice-studio/core";
import { buildPlan, comparePlan, computeRouting, loadTemplate, recipeHash, sameAddress, templateList } from "@lattice-studio/core";

/**
 * The plan of the Studio recipe (a loadable template, as loaded) whose recipe hash is `hash`, or null. A record
 * carries its recipe hash but no plan, so this is how a record of another recipe than the sheet's can still be checked.
 */
export function templatePlan(catalog: Catalog, hash: Hex): PlanEntry[] | null {
  for (const item of templateList(catalog)) {
    if (!item.loadable) continue;
    const recipe = loadTemplate(catalog, item.name);
    if (!recipe.ok || recipeHash(recipe.value, catalog).toLowerCase() !== hash.toLowerCase()) continue;
    return buildPlan(recipe.value, catalog, computeRouting(recipe.value, catalog)).entries;
  }
  return null;
}

export type Verdict = {
  matches: boolean;
  /** Selectors that differ, for "2 selectors differ" (spec L725). */
  differing: number;
  comparison?: PlanComparison;
};

function codehashOk(chain: ChainState | null, name: string, expected: Hex): boolean {
  const found = chain?.shared[name];
  return found?.present === true && found.codehash?.toLowerCase() === expected.toLowerCase();
}

export function judgeDiamond(args: {
  facets: readonly LoupeFacet[];
  chain: ChainState | null;
  catalog: Catalog;
  plan: readonly PlanEntry[] | null;
}): Verdict {
  const { facets, chain, catalog, plan } = args;
  if (plan !== null) {
    const comparison = comparePlan(plan, facets);
    let differing = comparison.missing.reduce((n, m) => n + m.selectors.length, 0)
      + comparison.extra.reduce((n, e) => n + e.selectors.length, 0)
      + comparison.moved.length;
    let codeOk = true;
    for (const entry of plan) {
      if (codehashOk(chain, entry.facet, entry.codehash)) continue;
      codeOk = false;
      differing += entry.selectors.length;
    }
    return { matches: comparison.matches && codeOk, differing, comparison };
  }
  if (facets.length === 0) return { matches: false, differing: 0 };
  let differing = 0;
  for (const facet of facets) {
    const release = catalog.facets.find((candidate) => sameAddress(candidate.release.address, facet.facetAddress));
    if (release && codehashOk(chain, release.name, release.release.codehash)) continue;
    differing += facet.functionSelectors.length;
  }
  return { matches: differing === 0, differing };
}

/**
 * The shared contract a name stands for, as core's `buildMissingDeploys` resolves it: LatticeRegistry,
 * LatticeFactory, a linked library, a facet, or an init contract by its catalog name or its contract name.
 */
export function releaseOf(catalog: Catalog, name: string): SharedContract | undefined {
  if (name === "LatticeRegistry") return catalog.registry;
  if (name === "LatticeFactory") return catalog.factory;
  const library = catalog.libraries?.find((candidate) => candidate.name === name);
  if (library) return library.release;
  const facet = catalog.facets.find((candidate) => candidate.name === name);
  if (facet) return facet.release;
  const init = catalog.inits.find((candidate) => candidate.name === name) ?? catalog.inits.find((candidate) => candidate.contract === name);
  return init?.release;
}

/** `names` with every `dependsOn` they reach, dependencies first, each once. Unknown names stay (core reports them). */
export function withDependencies(catalog: Catalog, names: readonly string[]): string[] {
  const out: string[] = [];
  const visit = (name: string, depth: number): void => {
    if (out.includes(name) || depth > 16) return;
    for (const dependency of releaseOf(catalog, name)?.dependsOn ?? []) visit(dependency, depth + 1);
    if (!out.includes(name)) out.push(name);
  };
  for (const name of names) visit(name, 0);
  return out;
}
