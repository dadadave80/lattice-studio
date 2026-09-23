// Studio's side of the golden comparison (spec L912, L927): what `analyze` routes and which init calls the
// diamond receives for a recipe, and a readable per-selector diff against golden/expected/<Recipe>.routing.json,
// which records what Lattice's own deploy script builds. Pure: the caller loads the catalog and the files.

import { analyze, planInit, type Catalog, type Recipe, type RecipeTemplate } from "@lattice-studio/core";
import type { InitKind, RoutingFile } from "../lib/report.ts";

/** What Studio plans for one recipe, in the expected file's terms. */
export type StudioSide = {
  recipe: string;
  /** The Lattice deploy script the template is pinned to. */
  script: string;
  /** Selector (lowercase) → the facet `analyze` routes it to. Unrouted selectors are left out. */
  routing: Record<string, string>;
  /** Selector → its signature in the catalog, for every routed selector. */
  signatures: Record<string, string>;
  /** Facets with at least one routed selector, in the cut plan's (catalog) order. */
  facets: string[];
  init: { kind: InitKind; steps: { init: string; signature: string }[] };
  /** Places where Studio disagrees with itself (the cut plan against the routing, the init target against its steps). */
  inconsistencies: string[];
};

const NOT_ROUTED = "(not routed)";

/** Runs `analyze` and C4a's `planInit` on a recipe and reads off the routing, the cut plan and the init calls. */
export function studioSide(template: RecipeTemplate, recipe: Recipe, catalog: Catalog): StudioSide {
  const analysis = analyze(recipe, catalog);
  const inconsistencies: string[] = [];
  const signatureOf = new Map<string, string>();
  for (const facet of catalog.facets) {
    for (const s of facet.selectors) signatureOf.set(`${facet.name} ${s.hex.toLowerCase()}`, s.signature);
  }

  const routing: Record<string, string> = {};
  const signatures: Record<string, string> = {};
  for (const [selector, route] of Object.entries(analysis.routing)) {
    if (route.owner === undefined) continue;
    const key = selector.toLowerCase();
    routing[key] = route.owner;
    const signature = signatureOf.get(`${route.owner} ${key}`);
    if (signature === undefined) inconsistencies.push(`${key}: ${route.owner} doesn't list this selector in the catalog`);
    else signatures[key] = signature;
  }

  // The cut plan is what the diamond receives: it must route exactly what the analysis routes.
  const planned = new Map<string, string>();
  for (const entry of analysis.plan) for (const s of entry.selectors) planned.set(s.toLowerCase(), entry.facet);
  for (const selector of union(Object.keys(routing), [...planned.keys()])) {
    const routed = routing[selector] ?? NOT_ROUTED;
    const cut = planned.get(selector) ?? NOT_ROUTED;
    if (routed !== cut) inconsistencies.push(`${selector}: the analysis routes it to ${routed}, the cut plan to ${cut}`);
  }

  const plan = planInit(recipe, catalog);
  const steps = plan.steps.map((step) => ({ init: step.contract, signature: step.fn }));
  const multiInit = catalog.inits.find((spec) => spec.name === "MultiInit")?.release?.address;
  const target = analysis.init?.target;
  let kind: InitKind = "none";
  if (target !== undefined) kind = sameAddress(target, multiInit) ? "MultiInit" : "direct";
  const wanted: InitKind = steps.length === 0 ? "none" : steps.length === 1 ? "direct" : "MultiInit";
  if (kind !== wanted) {
    inconsistencies.push(`init: the analysis calls ${describeTarget(kind, target)} for ${steps.length} init ${steps.length === 1 ? "step" : "steps"}`);
  } else if (kind === "direct") {
    const only = plan.steps[0];
    const spec = catalog.inits.find((candidate) => candidate.name === only?.spec);
    if (!sameAddress(target, spec?.release?.address)) {
      inconsistencies.push(`init: the analysis calls ${target ?? "nothing"}, not ${only?.spec ?? "its one step"}'s release address ${spec?.release?.address ?? "(none)"}`);
    }
  }

  return {
    recipe: template.name,
    script: template.script,
    routing,
    signatures,
    facets: analysis.plan.map((entry) => entry.facet),
    init: { kind, steps },
    inconsistencies,
  };
}

/**
 * One line per difference between Lattice's script (the expected file) and Studio's plan, empty when they agree:
 * `0xa9059cbb transfer(address,uint256): expected GovernedVault, Studio ERC20`. Facets compare as sets, since
 * the script's cut order and Studio's catalog order differ by design (LatticeFactory reorders cuts anyway).
 */
export function diffStudio(expected: RoutingFile, studio: StudioSide): string[] {
  const out: string[] = [];
  if (expected.recipe !== studio.recipe) out.push(`recipe: expected ${expected.recipe}, Studio ${studio.recipe}`);
  if (expected.script !== studio.script) out.push(`script: expected ${expected.script}, Studio ${studio.script}`);

  const lattice = new Set(expected.facets);
  const ours = new Set(studio.facets);
  const onlyLattice = expected.facets.filter((f) => !ours.has(f));
  const onlyStudio = studio.facets.filter((f) => !lattice.has(f));
  if (onlyLattice.length > 0) out.push(`facets only in Lattice's script: ${onlyLattice.join(", ")}`);
  if (onlyStudio.length > 0) out.push(`facets only in Studio's plan: ${onlyStudio.join(", ")}`);

  const expectedRouting = lowercaseKeys(expected.routing);
  const expectedSignatures = lowercaseKeys(expected.signatures);
  for (const selector of union(Object.keys(expectedRouting), Object.keys(studio.routing))) {
    const was = expectedRouting[selector] ?? NOT_ROUTED;
    const now = studio.routing[selector] ?? NOT_ROUTED;
    const signature = expectedSignatures[selector] ?? studio.signatures[selector];
    const label = signature === undefined ? selector : `${selector} ${signature}`;
    if (was !== now) {
      out.push(`${label}: expected ${was}, Studio ${now}`);
      continue;
    }
    const theirs = expectedSignatures[selector];
    const mine = studio.signatures[selector];
    if (theirs !== mine) out.push(`${selector}: signature expected ${theirs ?? "(none)"}, Studio ${mine ?? "(none)"}`);
  }

  if (expected.init.kind !== studio.init.kind) out.push(`init: expected ${expected.init.kind}, Studio ${studio.init.kind}`);
  const count = Math.max(expected.init.steps.length, studio.init.steps.length);
  for (let i = 0; i < count; i++) {
    const was = expected.init.steps[i];
    const now = studio.init.steps[i];
    const a = was === undefined ? "(no step)" : `${was.init}.${was.signature}`;
    const b = now === undefined ? "(no step)" : `${now.init}.${now.signature}`;
    if (a !== b) out.push(`init step ${i}: expected ${a}, Studio ${b}`);
  }

  for (const line of studio.inconsistencies) out.push(`Studio: ${line}`);
  return out;
}

function union(a: readonly string[], b: readonly string[]): string[] {
  return [...new Set([...a, ...b])].sort();
}

function lowercaseKeys(record: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) out[key.toLowerCase()] = value;
  return out;
}

function sameAddress(a: string | undefined, b: string | undefined): boolean {
  return a !== undefined && b !== undefined && a.toLowerCase() === b.toLowerCase();
}

function describeTarget(kind: InitKind, target: string | undefined): string {
  if (kind === "none") return "no init";
  return kind === "MultiInit" ? `MultiInit (${target ?? "?"})` : `a direct init (${target ?? "?"})`;
}
