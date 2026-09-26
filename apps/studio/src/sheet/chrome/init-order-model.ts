/**
 * What init order mode draws (spec L383, Flow 7 step 5): which card carries which step badge, the order the
 * dashed path and the legend follow, and which steps can move. Pure; cached per recipe and catalog, because
 * every card asks for its own badge on each render while the mode is on.
 */
import type { Catalog, InitPlan, Recipe } from "@lattice-studio/core";
import { isNotImplemented, planInit } from "@lattice-studio/core";

export type InitOrderStep = {
  /** 1-based, on the badge and in the legend. */
  number: number;
  /** The legend's words: the init's name, the bundle's module, or the automatic step's line. */
  label: string;
  /**
   * The recipe step this is (`recipe.init.steps[index]`), for `init.moveStep`; null when it can't move (a
   * bundle's module, the automatic ERC-165 step).
   */
  index: number | null;
  /** The placed facets whose card carries this badge, in recipe order. */
  facets: string[];
};

export type InitOrderModel = {
  kind: InitPlan["kind"];
  /** The bundle's init, when `kind` is "bundle". */
  bundle: string | null;
  /** In call order: the order the path visits and the legend lists. */
  steps: InitOrderStep[];
  /** Each badged card's step. A placed facet that isn't here has no step and dims. */
  byFacet: ReadonlyMap<string, InitOrderStep>;
  /** Steps that can move: two or more make dragging a badge meaningful. */
  movable: number;
};

/** Flow 7 step 6: the appended ERC-165 step's line. */
export const AUTOMATIC_STEP = "Register ERC-165 interfaces (automatic)";

const NONE: InitOrderModel = { kind: "none", bundle: null, steps: [], byFacet: new Map(), movable: 0 };

const STEP_PATH = /^steps\[(0|[1-9][0-9]*)\]$/;

function planOf(recipe: Recipe, catalog: Catalog): InitPlan | null {
  try {
    return planInit(recipe, catalog);
  } catch (error) {
    if (isNotImplemented(error)) return null;
    throw error;
  }
}

/**
 * Step inits: a card carries the badge of the step that runs its own init (`Facet.init`); failing that, of the
 * first step whose init initializes a module of the card's name (SafeDiamondCutInit sets up AccessControl and
 * EmergencyStop too). The automatic step names no card.
 */
function stepModel(plan: InitPlan, recipe: Recipe, catalog: Catalog): InitOrderModel {
  const facetInit = new Map(catalog.facets.map((f) => [f.name, f.init]));
  const specs = new Map(catalog.inits.map((spec) => [spec.name, spec]));
  const steps: InitOrderStep[] = plan.steps.map((view, i) => {
    const match = STEP_PATH.exec(view.path);
    const index = view.locked || match?.[1] === undefined ? null : Number(match[1]);
    return { number: i + 1, label: view.automatic ? AUTOMATIC_STEP : view.spec, index, facets: [] };
  });
  const byFacet = new Map<string, InitOrderStep>();
  for (const facet of recipe.facets) {
    let at = plan.steps.findIndex((view) => !view.automatic && facetInit.get(facet) === view.spec);
    if (at < 0) {
      at = plan.steps.findIndex(
        (view) => !view.automatic && (specs.get(view.spec)?.initializes ?? []).some((m) => m.module === facet),
      );
    }
    const step = steps[at];
    if (!step) continue;
    step.facets.push(facet);
    byFacet.set(facet, step);
  }
  return { kind: "steps", bundle: null, steps, byFacet, movable: steps.filter((s) => s.index !== null).length };
}

/** A bundle: its internal order, read-only, one badge per placed facet named in it. */
function bundleModel(plan: InitPlan, recipe: Recipe): InitOrderModel {
  const bundle = plan.steps[0]?.spec ?? null;
  const placed = new Set(recipe.facets);
  const steps: InitOrderStep[] = (plan.sequence ?? []).map((module, i) => ({
    number: i + 1, label: module, index: null, facets: placed.has(module) ? [module] : [],
  }));
  const byFacet = new Map<string, InitOrderStep>();
  for (const step of steps) for (const facet of step.facets) byFacet.set(facet, step);
  return { kind: "bundle", bundle, steps, byFacet, movable: 0 };
}

/** The model for this recipe, uncached. */
export function buildInitOrderModel(recipe: Recipe, catalog: Catalog): InitOrderModel {
  const plan = planOf(recipe, catalog);
  if (!plan || plan.kind === "none" || plan.steps.length === 0) return NONE;
  return plan.kind === "bundle" ? bundleModel(plan, recipe) : stepModel(plan, recipe, catalog);
}

const cache = new WeakMap<Recipe, { catalog: Catalog; model: InitOrderModel }>();

/** The model for this recipe and catalog: one object per recipe, so every card shares it. */
export function initOrderModel(recipe: Recipe, catalog: Catalog): InitOrderModel {
  const hit = cache.get(recipe);
  if (hit && hit.catalog === catalog) return hit.model;
  const model = buildInitOrderModel(recipe, catalog);
  cache.set(recipe, { catalog, model });
  return model;
}

/** "03": the badge's two digits, as the board draws them. */
export function badgeText(number: number): string {
  return String(number).padStart(2, "0");
}
