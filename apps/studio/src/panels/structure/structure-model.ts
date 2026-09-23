/**
 * The Structure tree's content (spec L747, IR L90-L97): the sheet's facets with their selectors, a Problems
 * branch and an Init plan branch, as `Tree` nodes plus what each node is. Pure: the panel renders this and
 * decides nothing about a selector's state, a name or a step's moves itself, so every rule is unit-tested.
 *
 * A facet's name, count and description are its card's, and a selector's state, words and action are its
 * pin's: both come from S4a's card model (`cardView`, `pinView`), so the tree and the card can't drift
 * (spec L745-L746, Flow 6, IR L104).
 */
import type { Analysis, Catalog, Hex4, InitPlan, InitStepView, Problem, Recipe, Severity } from "@lattice-studio/core";
import { plural } from "@lattice-studio/core";
import { layoutMetrics } from "@/contracts/layout-metrics";
import { cardAnalysis, cardView, type PinView, type TooltipCopy } from "@/sheet/card/card-model";
import type { TreeNode } from "@/ui/nav/tree-model";

// ---------------------------------------------------------------------------------------------------------
// Ids

/** Problems and Init plan are the two branches after the facets. */
export const PROBLEMS_ID = "problems";
export const INIT_ID = "init";

export const facetId = (facet: string): string => `facet:${facet}`;
export const selectorId = (facet: string, selector: Hex4): string => `selector:${facet}:${selector}`;
export const problemId = (id: string): string => `problem:${id}`;

/** The facet a node id names, or null when it isn't a facet's. */
export function facetOfId(id: string): string | null {
  return id.startsWith("facet:") ? id.slice("facet:".length) : null;
}

/** A pin's tooltip as one sentence: what a seam or an unchecked selector says when Space has nothing to run. */
export function tooltipText(tooltip: TooltipCopy): string {
  return `${tooltip.code ?? ""}${tooltip.text}`;
}

// ---------------------------------------------------------------------------------------------------------
// Problems

/** Severity has a word (spec L771). */
export const SEVERITY_WORD: Record<Severity, string> = { blocker: "Blocker", warning: "Warning", info: "Info" };

/** A message without its code marks: "`transfer` 0xa9059cbb" → "transfer 0xa9059cbb". */
export function plainText(message: string): string {
  return message.replaceAll("`", "");
}

/** Text and code runs of a message: "`lattice.storage.ERC20`" renders as code (spec L670). */
export function codeRuns(message: string): { code: boolean; text: string }[] {
  return message.split("`").map((text, i) => ({ code: i % 2 === 1, text })).filter((run) => run.text !== "");
}

// ---------------------------------------------------------------------------------------------------------
// Init plan

/** A step's place in the recipe, for Alt + ↑ ↓: only step inits move (a bundle and the automatic step don't). */
export type StepMove = { path: string; index: number; count: number } | null;

export const AUTOMATIC_LABEL = "Register ERC-165 interfaces (automatic)";

/** A step's visible name: its init, or the automatic step's words (spec L468). */
export function stepTitle(step: InitStepView): string {
  return step.automatic ? AUTOMATIC_LABEL : step.spec;
}

/** Whether Alt + ↑ ↓ can move this step, and where it is among the recipe's steps. */
export function stepMove(step: InitStepView, recipe: Recipe): StepMove {
  const init = recipe.init;
  if (init.kind !== "steps" || step.locked) return null;
  const m = /^steps\[(0|[1-9][0-9]*)\]$/.exec(step.path);
  if (m?.[1] === undefined) return null;
  return { path: step.path, index: Number(m[1]), count: init.steps.length };
}

/**
 * Where Alt + ↑ (-1) or Alt + ↓ (+1) takes a step, or why it can't move, as the console says it
 * (the bundle wording is S1's `init.reorderAuto` refusal).
 */
export function moveTarget(
  step: InitStepView,
  recipe: Recipe,
  delta: -1 | 1,
): { ok: true; path: string; to: number } | { ok: false; reason: string } {
  const init = recipe.init;
  if (init.kind === "bundle") return { ok: false, reason: `${init.spec} is a bundle: its order is fixed.` };
  if (step.automatic) return { ok: false, reason: `${AUTOMATIC_LABEL} always runs last.` };
  const move = stepMove(step, recipe);
  if (!move) return { ok: false, reason: `${step.spec} can't move.` };
  const to = move.index + delta;
  if (to < 0) return { ok: false, reason: `${step.spec} is already the first step.` };
  if (to >= move.count) return { ok: false, reason: `${step.spec} is already the last step.` };
  return { ok: true, path: move.path, to };
}

// ---------------------------------------------------------------------------------------------------------
// The tree

/** What a node is. */
export type StructureMeta =
  | { kind: "facet"; facet: string; label: string; description: string; count: string; known: boolean }
  | { kind: "selector"; facet: string; view: PinView }
  | { kind: "problems"; label: string; count: number }
  | { kind: "problem"; problem: Problem; label: string }
  | { kind: "init"; label: string; summary: string }
  | { kind: "step"; step: InitStepView; label: string }
  | { kind: "sequence"; bundle: string; module: string; position: number; label: string };

export type Structure = {
  nodes: TreeNode[];
  meta: ReadonlyMap<string, StructureMeta>;
  /** Facet ids in tree order, for focus after a delete. */
  facets: string[];
};

export type StructureInput = {
  recipe: Recipe;
  catalog: Catalog | null;
  analysis: Analysis;
  /** C4a's plan; null while the catalog loads. */
  plan: InitPlan | null;
};

/** Step ids follow the init, not its position, so a moved step keeps its row (and focus) with it. */
function stepIds(steps: readonly InitStepView[]): string[] {
  const seen = new Map<string, number>();
  return steps.map((step) => {
    if (step.automatic) return "step:auto";
    if (step.path === "bundle") return "step:bundle";
    const n = seen.get(step.spec) ?? 0;
    seen.set(step.spec, n + 1);
    return n === 0 ? `step:${step.spec}` : `step:${step.spec}#${n + 1}`;
  });
}

function initSummary(plan: InitPlan | null, recipe: Recipe): string {
  const init = recipe.init;
  if (init.kind === "bundle") return `${init.spec} bundle`;
  if (init.kind === "none") return "no init";
  return plural(plan?.steps.length ?? init.steps.length, "step");
}

/** The tree: every placed facet (recipe order) with its selectors, then Problems, then Init plan. */
export function buildStructure({ recipe, catalog, analysis, plan }: StructureInput): Structure {
  const meta = new Map<string, StructureMeta>();
  const nodes: TreeNode[] = [];
  const excluded = new Set(recipe.exclude);
  const facets: string[] = [];

  for (const name of recipe.facets) {
    const id = facetId(name);
    facets.push(id);
    const facet = catalog?.facets.find((f) => f.name === name);
    if (!catalog || !facet) {
      meta.set(id, { kind: "facet", facet: name, label: name, description: "", count: "", known: false });
      nodes.push({ id, label: name });
      continue;
    }
    // The card's own view: its name, count, connections and pins, whatever its size on the sheet.
    const card = cardView({
      facet, catalog, slice: cardAnalysis(analysis, facet), excluded, placed: recipe.facets,
      pins: "right", expanded: true, compact: false, metrics: layoutMetrics,
    });
    meta.set(id, { kind: "facet", facet: name, label: card.name, description: card.connections, count: card.count, known: true });
    const children = card.all.map((view): TreeNode => {
      const child = selectorId(name, view.selector);
      meta.set(child, { kind: "selector", facet: name, view });
      return { id: child, label: view.signature };
    });
    nodes.push({ id, label: name, ...(children.length > 0 ? { children } : {}) });
  }

  const problems = analysis.problems.map((problem): TreeNode => {
    const id = problemId(problem.id);
    const text = plainText(problem.message);
    meta.set(id, { kind: "problem", problem, label: `${SEVERITY_WORD[problem.severity]}: ${text}` });
    return { id, label: text };
  });
  meta.set(PROBLEMS_ID, {
    kind: "problems",
    label: problems.length === 0 ? "Problems, none" : `Problems, ${problems.length}`,
    count: problems.length,
  });
  nodes.push({ id: PROBLEMS_ID, label: "Problems", ...(problems.length > 0 ? { children: problems } : {}) });

  const steps = plan?.steps ?? [];
  const ids = stepIds(steps);
  const stepNodes = steps.map((step, i): TreeNode => {
    const id = ids[i] ?? `step:${i}`;
    const title = stepTitle(step);
    const position = `Step ${step.index + 1}`;
    if (step.path === "bundle") {
      const sequence = plan?.sequence ?? [];
      const children = sequence.map((module, n): TreeNode => {
        const child = `sequence:${n}`;
        meta.set(child, {
          kind: "sequence", bundle: step.spec, module, position: n,
          label: `${module}, ${n + 1} of ${sequence.length}, read-only`,
        });
        return { id: child, label: module };
      });
      meta.set(id, { kind: "step", step, label: `${title}, bundle, ${step.fn}, its order is fixed` });
      return { id, label: title, ...(children.length > 0 ? { children } : {}) };
    }
    const locked = step.locked ? ", locked" : "";
    meta.set(id, { kind: "step", step, label: `${position}, ${title}, ${step.fn}${locked}` });
    return { id, label: title };
  });
  const summary = initSummary(plan, recipe);
  meta.set(INIT_ID, { kind: "init", label: `Init plan, ${summary}`, summary });
  nodes.push({ id: INIT_ID, label: "Init plan", ...(stepNodes.length > 0 ? { children: stepNodes } : {}) });

  return { nodes, meta, facets };
}

/**
 * Where focus goes after `removed` leave the tree: the next facet in tree order, else the previous one, else
 * null (the tree's first row takes it).
 */
export function focusAfterRemove(facets: readonly string[], removed: ReadonlySet<string>, focused: string): string | null {
  const at = facets.indexOf(focused);
  if (at < 0) return null;
  for (let i = at + 1; i < facets.length; i++) {
    const id = facets[i];
    if (id !== undefined && !removed.has(id)) return id;
  }
  for (let i = at - 1; i >= 0; i--) {
    const id = facets[i];
    if (id !== undefined && !removed.has(id)) return id;
  }
  return null;
}
