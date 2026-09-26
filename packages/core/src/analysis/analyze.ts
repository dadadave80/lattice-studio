import { canonicalJson, normalizeRecipe, recipeHash } from "../canonical";
import { runChecks } from "../checks";
import { collectRefs, encodeInit } from "../init/encode";
import { planInit } from "../init/plan";
import type { Analysis, AnalysisContext, PlanEntry, Routing } from "../model/analysis";
import type { AnalyzeFn } from "../model/api";
import type { Address } from "../model/hex";
import type { Catalog } from "../model/catalog";
import type { InitPlan } from "../model/init";
import type { Recipe } from "../model/recipe";
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
 * `options.checks` bypass the memo. The result is deep-frozen, since the memo hands the same object to every
 * caller: copy before sorting or editing it.
 *
 * A neighbor that hasn't landed throws `NotImplemented` ("Not built yet · WP-<id>") through to the UI boundary:
 * a stub never silently drops blockers (spec L296). Tests isolate checks with `options.checks`.
 */
export const analyze: AnalyzeFn = (recipe, catalog, ctx, options) => {
  const context = ctx ?? EMPTY_CONTEXT;
  const normalized = settle(normalizeRecipe(recipe, catalog));
  const hash = recipeHash(normalized);
  const key = options?.checks === undefined ? memoKey(hash, normalized, catalog, context) : null;
  const cached = key === null ? undefined : recall(catalog, key);
  if (cached !== undefined) return cached;

  const routing = computeRouting(normalized, catalog);
  const problems = sortProblems(runChecks({ recipe: normalized, catalog, routing, ctx: context }, options?.checks), catalog);
  const analysis: Analysis = Object.freeze({
    recipeHash: hash,
    routing: freezeRouting(routing),
    problems: frozenCopy(problems),
    plan: freezePlan(buildPlan(normalized, catalog, routing).entries),
    init: freezeInit(initSummary(normalized, catalog, context)),
    stats: Object.freeze(statsOf(normalized, catalog, routing)),
  });
  if (key !== null) remember(catalog, key, analysis);
  return analysis;
};

/**
 * The init call the diamond receives (contracts §3.1, "Init encoding ruling"): none → null; a final call list
 * (C4a's plan, with the automatic introspection step added or skipped) of exactly one call → that init's
 * release address, a direct call; two or more → MultiInit. The target never depends on the context. `data`
 * only once a deploy context resolves every reference the arguments use (spec L263) and C4b encodes them.
 */
function initSummary(recipe: Recipe, catalog: Catalog, ctx: AnalysisContext): Analysis["init"] {
  if (recipe.init.kind === "none") return null;
  const plan = planInit(recipe, catalog);
  const target = initTarget(plan, catalog);
  if (target === undefined) return null;
  const refs = collectRefs(recipe);
  const summary: NonNullable<Analysis["init"]> = { target, refs };
  const resolved = ctx.refs;
  if (ctx.deploy === undefined || resolved === undefined || !refs.every((ref) => resolved[ref] !== undefined)) return summary;
  const call = encodeInit(plan, catalog, resolved);
  return call.ok ? { target, data: call.value.data, refs } : summary;
}

/** One call: its init's release address. Several: MultiInit's. Undefined when there's no call or no release. */
function initTarget(plan: InitPlan, catalog: Catalog): Address | undefined {
  const [only, ...rest] = plan.steps;
  if (only === undefined) return undefined;
  const spec = rest.length > 0 ? "MultiInit" : only.spec;
  const found =
    catalog.inits.find((candidate) => candidate.name === spec) ??
    (rest.length > 0 ? undefined : catalog.inits.find((candidate) => candidate.contract === only.contract && candidate.release !== undefined));
  return found?.release?.address;
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

/**
 * The normalized recipe with the fields `recipeView` reads frozen, so routing, the checks and the stats share
 * one view of it (view.ts). `normalizeRecipe` builds `facets`, `owners` and `exclude` afresh, so the caller's
 * recipe is never touched; the rest (init arguments, unknown fields) may be the caller's and stays as it is.
 */
function settle(recipe: Recipe): Recipe {
  Object.freeze(recipe.facets);
  Object.freeze(recipe.owners);
  Object.freeze(recipe.exclude);
  return recipe;
}

/*
 * Immutability without a whole-result copy. Routing (`computeRouting`), the plan (`buildPlan`), the init
 * summary and the stats are built afresh for this call and hold only strings and numbers, so they're frozen
 * where they stand. Problems come from the checks, which may hold catalog, recipe or context arrays in their
 * params by reference: each is copied as it's frozen, and what it pointed at stays unfrozen.
 */

function freezeRouting(routing: Routing): Routing {
  for (const route of Object.values(routing)) {
    Object.freeze(route.contenders);
    Object.freeze(route);
  }
  return Object.freeze(routing);
}

function freezePlan(entries: PlanEntry[]): PlanEntry[] {
  for (const entry of entries) {
    Object.freeze(entry.selectors);
    Object.freeze(entry);
  }
  Object.freeze(entries);
  return entries;
}

function freezeInit(init: Analysis["init"]): Analysis["init"] {
  if (init === null) return null;
  Object.freeze(init.refs);
  return Object.freeze(init);
}

/** A frozen copy of plain data (arrays, objects, primitives), keys in the same order, `undefined` members kept. */
function frozenCopy<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return Object.freeze(value.map(frozenCopy)) as T;
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value)) out[key] = frozenCopy((value as Record<string, unknown>)[key]);
  return Object.freeze(out) as T;
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
