import { analyze } from "../analysis/analyze";
import { computeRouting } from "../analysis/routing";
import { CHECKS, checkCore } from "../checks";
import type { Analysis, AnalysisContext, Check } from "../model/analysis";
import type { Catalog } from "../model/catalog";
import type { LoupeFacet } from "../model/chain";
import type { Hex, Hex4 } from "../model/hex";
import type { Problem } from "../model/problems";
import type { UpgradeOrigin } from "../model/project";
import type { Recipe } from "../model/recipe";
import { err, ok, type Result } from "../model/result";
import { buildUpgradeCuts, type UpgradeCut, type UpgradeSelectorLock } from "./cuts";
import { reconstructUpgrade } from "./reconstruct";
import { resolveUpgrade, type UpgradeResolution } from "./resolve";

export type UpgradePlan = {
  analysis: Analysis;
  cuts: UpgradeCut[];
  expectedFacets: LoupeFacet[];
  expectedCodehashes: Record<string, Hex>;
};

function information(problem: Problem): Problem {
  const { ack: _ack, ...rest } = problem;
  return { ...rest, severity: "info", fixes: [] };
}

function inheritedPresence(problem: Problem, baseline: readonly Problem[]): boolean {
  const previous = baseline.find((candidate) => candidate.code === problem.code);
  if (previous === undefined) return false;
  if (problem.code !== "CORE-01") return ["CORE-02", "CORE-04", "CORE-05"].includes(problem.code);
  const missing = problem.params.missing;
  const before = previous.params.missing;
  return Array.isArray(missing) && Array.isArray(before) && missing.every((selector) => before.includes(selector));
}

function checksFor(baseline: Recipe, catalog: Catalog, ctx: AnalysisContext): Check[] {
  const routing = computeRouting(baseline, catalog);
  const presence = checkCore({ recipe: baseline, catalog, routing, ctx });
  return CHECKS.filter((check) => check.name !== "net").map(({ run }) => (input) => run(input).map((problem) => {
    if (inheritedPresence(problem, presence)) return information(problem);
    // A retained runtime's initialization cannot be inferred from its bytecode. Newly requested steps
    // still receive INIT-01/02/03/05 and same-call INIT-04, and newly placed facets still require init.
    if (problem.code === "INIT-04" && problem.where.some((anchor) => anchor.kind === "facet" && Object.hasOwn(baseline.facetInstances ?? {}, anchor.facet))) return information(problem);
    if (problem.code === "SEL-04") {
      const selector = problem.params.selector as Hex4;
      const owner = input.routing[selector]?.owner;
      if (owner !== undefined && baseline.owners[selector] === owner) return information(problem);
    }
    return problem;
  }));
}

function locks(resolved: UpgradeResolution): UpgradeSelectorLock[] {
  return resolved.raw.flatMap((row) => row.kind === "self" ? [] : [{ kind: row.kind, facetAddress: row.address, functionSelectors: row.selectors }]);
}

function desired(analysis: Analysis): LoupeFacet[] {
  return analysis.plan.map((entry) => ({ facetAddress: entry.address, functionSelectors: [...entry.selectors].sort() }))
    .sort((a, b) => a.facetAddress.toLowerCase() < b.facetAddress.toLowerCase() ? -1 : 1);
}

/**
 * Checks an upgrade against its pinned facts. Actual instances cannot acquire different identity metadata
 * through an edited file. Only pre-existing core/init omissions become information; selector, semantic,
 * dependency, storage, requested init, authority and link checks remain. Fresh factory/CREATE3 readiness
 * checks are not cut preflight; the live upgrade controller must recheck chain, code, authority and gas.
 */
export function analyzeUpgrade(recipe: Recipe, catalog: Catalog, origin: UpgradeOrigin, ctx?: AnalysisContext): Result<Analysis, string> {
  const resolved = resolveUpgrade(recipe, catalog);
  if (!resolved.ok) return resolved;
  const rebuilt = reconstructUpgrade(origin, catalog);
  if (!rebuilt.ok) return rebuilt;
  const baseline = rebuilt.value;
  for (const [id, instance] of Object.entries(recipe.facetInstances ?? {})) {
    const previous = baseline.facetInstances?.[id];
    if (previous === undefined || previous.kind !== instance.kind || previous.codehash.toLowerCase() !== instance.codehash.toLowerCase()
      || (previous.kind === "known" && instance.kind === "known" && previous.catalogFacet !== instance.catalogFacet)) {
      return err("An on-chain instance doesn't match the upgrade's pinned origin.");
    }
    const selectors = instance.kind === "known" ? instance.extraSelectors : instance.selectors;
    const original = previous.kind === "known" ? previous.extraSelectors : previous.selectors;
    if (selectors.map((selector) => selector.toLowerCase()).sort().join(",") !== original.map((selector) => selector.toLowerCase()).sort().join(",")) {
      return err("Raw facet descriptors must retain the selectors observed at their pinned origin.");
    }
  }
  const before = resolveUpgrade(baseline, catalog);
  if (!before.ok) return before;
  const context: AnalysisContext = { ...(ctx ?? { known: [], unconfirmed: [] }), refs: { ...ctx?.refs, self: origin.address } };
  const analysis = analyze(recipe, catalog, context, { checks: checksFor(baseline, before.value.catalog, context) });
  for (const entry of analysis.plan) {
    const original = Object.entries(origin.codehashes).find(([address]) => address.toLowerCase() === entry.address.toLowerCase())?.[1];
    if (original !== undefined && original.toLowerCase() !== entry.codehash.toLowerCase()) return err("A cut cannot change the runtime code at an existing facet address.");
  }
  const checked = buildUpgradeCuts({ diamond: origin.address, current: origin.facets, desired: desired(analysis), locked: locks(before.value) });
  if (!checked.ok) return checked;
  return ok(analysis);
}

/** Exact Add/Replace/Remove cuts and expected post-receipt facts; never a fresh deployment transaction. */
export function planUpgrade(recipe: Recipe, catalog: Catalog, origin: UpgradeOrigin, ctx?: AnalysisContext): Result<UpgradePlan, string> {
  const checked = analyzeUpgrade(recipe, catalog, origin, ctx);
  if (!checked.ok) return checked;
  const analysis = checked.value;
  const expectedFacets = desired(analysis);
  const rebuilt = reconstructUpgrade(origin, catalog);
  if (!rebuilt.ok) return rebuilt;
  const before = resolveUpgrade(rebuilt.value, catalog);
  if (!before.ok) return before;
  const cuts = buildUpgradeCuts({ diamond: origin.address, current: origin.facets, desired: expectedFacets, locked: locks(before.value) });
  if (!cuts.ok) return cuts;
  const diamondHash = Object.entries(origin.codehashes).find(([address]) => address.toLowerCase() === origin.address.toLowerCase())?.[1];
  if (diamondHash === undefined) return err("The baseline is missing the diamond's runtime code hash.");
  return ok({ analysis, cuts: cuts.value, expectedFacets,
    expectedCodehashes: {
      ...Object.fromEntries(analysis.plan.map((entry) => [entry.address.toLowerCase(), entry.codehash])),
      [origin.address.toLowerCase()]: diamondHash.toLowerCase() as Hex,
    },
  });
}
