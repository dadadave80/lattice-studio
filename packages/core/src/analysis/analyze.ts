import { canonicalJson, normalizeRecipe, recipeHash } from "../canonical";
import { CHECKS, runChecks } from "../checks";
import { collectRefs, encodeInit } from "../init/encode";
import { planInit } from "../init/plan";
import type { Analysis, AnalysisContext, Check, PlanEntry, Routing } from "../model/analysis";
import type { AnalyzeFn } from "../model/api";
import type { Catalog } from "../model/catalog";
import type { Recipe } from "../model/recipe";
import { isNotImplemented } from "../model/wp";
import { buildPlan } from "../plan";
import { computeRouting } from "./routing";
import { sortProblems } from "./sort";
import { EXPORT_SELECTORS, recipeView } from "./view";

const EMPTY_CONTEXT: AnalysisContext = { known: [], unconfirmed: [] };

/** Analyses kept per catalog object: undo and redo revisit recent recipes. */
const MEMO_SIZE = 32;
const memo = new WeakMap<Catalog, Map<string, Analysis>>();

/**
 * Routing, problems, the cut plan, the init call and stats (spec L296-L305). Pure and deterministic: the recipe
 * is normalized first (facets in catalog order, hex lowercase), so the order facets were placed in never
 * shows. Memoized per catalog on the recipe hash, the catalog hash and a digest of the context; injected
 * `options.checks` bypass the memo.
 *
 * Until C5a, C4a and C4b land, a stub they still hold degrades instead of throwing: the plan is empty, the init
 * summary null, and a check that throws `NotImplemented` contributes no problems.
 */
export const analyze: AnalyzeFn = (recipe, catalog, ctx, options) => {
  const context = ctx ?? EMPTY_CONTEXT;
  const normalized = normalizeRecipe(recipe, catalog);
  const hash = recipeHash(normalized);
  const key = options?.checks === undefined ? memoKey(hash, normalized, catalog, context) : null;
  const cached = key === null ? undefined : recall(catalog, key);
  if (cached !== undefined) return cached;

  const routing = computeRouting(normalized, catalog);
  const checks = options?.checks ?? CHECKS.map((check) => degradeCheck(check.run));
  const problems = sortProblems(runChecks({ recipe: normalized, catalog, routing, ctx: context }, checks), catalog);
  const analysis: Analysis = {
    recipeHash: hash,
    routing,
    problems,
    plan: planOf(normalized, catalog, routing),
    init: initSummary(normalized, catalog, context),
    stats: statsOf(normalized, catalog, routing),
  };
  if (key !== null) remember(catalog, key, analysis);
  return analysis;
};

function planOf(recipe: Recipe, catalog: Catalog, routing: Routing): PlanEntry[] {
  return degrade(() => buildPlan(recipe, catalog, routing).entries, []);
}

/**
 * The init call the diamond receives: bundle → the bundle's init contract, steps → MultiInit (C4b), none →
 * null. `data` only once a deploy context resolves every reference the arguments use (spec L263) and the
 * arguments encode.
 */
function initSummary(recipe: Recipe, catalog: Catalog, ctx: AnalysisContext): Analysis["init"] {
  const init = recipe.init;
  if (init.kind === "none") return null;
  const spec = init.kind === "bundle" ? init.spec : "MultiInit";
  const target = catalog.inits.find((candidate) => candidate.name === spec)?.release?.address;
  if (target === undefined) return null;
  const refs = degrade(() => collectRefs(recipe), null);
  if (refs === null) return null;
  const summary: NonNullable<Analysis["init"]> = { target, refs };
  const resolved = ctx.refs;
  if (ctx.deploy === undefined || resolved === undefined || !refs.every((ref) => resolved[ref] !== undefined)) return summary;
  const call = degrade(() => encodeInit(planInit(recipe, catalog), catalog, resolved), null);
  if (call === null || !call.ok) return summary;
  return { target: call.value.target, data: call.value.data, refs };
}

/**
 * `facets` placed (known to the catalog), `routed` selectors with an owner, `exported` selectors counted per
 * facet (GovernedVault: 120 routed of 143), `excluded` exported selectors left out, `namespaces` the distinct
 * ERC-7201 namespaces the placed facets own.
 */
function statsOf(recipe: Recipe, catalog: Catalog, routing: Routing): Analysis["stats"] {
  const view = recipeView(recipe, catalog);
  const exported = view.placed.reduce(
    (sum, facet) => sum + facet.selectors.filter((s) => s.hex.toLowerCase() !== EXPORT_SELECTORS).length,
    0,
  );
  return {
    facets: view.placed.length,
    routed: Object.values(routing).filter((route) => route.owner !== undefined).length,
    exported,
    excluded: [...view.contenders.keys()].filter((selector) => view.exclude.has(selector)).length,
    namespaces: new Set(view.placed.flatMap((facet) => (facet.storage ? [facet.storage.id] : []))).size,
  };
}

/** `run()`, or `fallback` when it throws `NotImplemented` (a neighbor's stub); any other error propagates. */
function degrade<T>(run: () => T, fallback: T): T {
  try {
    return run();
  } catch (error) {
    if (isNotImplemented(error)) return fallback;
    throw error;
  }
}

function degradeCheck(check: Check): Check {
  return (input) => degrade(() => check(input), []);
}

function memoKey(hash: string, recipe: Recipe, catalog: Catalog, ctx: AnalysisContext): string | null {
  try {
    return [hash, catalog.hash, canonicalJson(recipe.template ?? null), canonicalJson(withoutUndefined(ctx))].join("|");
  } catch {
    return null;
  }
}

/** A copy without `undefined` members, which canonical JSON can't hold but an optional field may carry. */
function withoutUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutUndefined);
  if (value === null || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [field, member] of Object.entries(value)) if (member !== undefined) out[field] = withoutUndefined(member);
  return out;
}

/** The memoized analysis for `key`, moved to the most recent end. */
function recall(catalog: Catalog, key: string): Analysis | undefined {
  const entries = memo.get(catalog);
  const found = entries?.get(key);
  if (entries === undefined || found === undefined) return undefined;
  entries.delete(key);
  entries.set(key, found);
  return found;
}

function remember(catalog: Catalog, key: string, analysis: Analysis): void {
  let entries = memo.get(catalog);
  if (entries === undefined) {
    entries = new Map();
    memo.set(catalog, entries);
  }
  entries.set(key, analysis);
  if (entries.size > MEMO_SIZE) {
    const oldest = entries.keys().next().value;
    if (oldest !== undefined) entries.delete(oldest);
  }
}
