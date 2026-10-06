/**
 * The Structure tree's content (spec L747, IR L90-L97): the core (the proxy's fallback, DiamondLoupeFacet and
 * ERC165Facet), the sheet's facets with their selectors grouped by area as the boards draw it (the pinned core
 * first, then one group per area), a Problems branch and an Init plan branch, as `Tree` nodes plus what each
 * node is. Pure: the panel renders this and decides nothing about a selector's state, a
 * name or a step's moves itself, so every rule is unit-tested.
 *
 * A facet's name, count and description are its card's, and a selector's state, words and action are its
 * pin's: both come from S4a's card model (`cardView`, `pinView`), so the tree and the card can't drift
 * (spec L745-L746, Flow 6, IR L104). The core's facets read the same way, though they're never cards.
 */
import type { Analysis, Area, Catalog, Facet, Hex4, InitPlan, InitStepView, Problem, Recipe, Severity } from "@lattice-studio/core";
import { CORE_FACETS, isCoreFacet, plural } from "@lattice-studio/core";
import { layoutMetrics } from "@/contracts/layout-metrics";
import { cardAnalysis, cardView, type PinView, type TooltipCopy } from "@/sheet/card/card-model";
import { AREA_LABELS } from "../catalog/catalog-tree";
import type { TreeNode } from "@/ui/nav/tree-model";

// ---------------------------------------------------------------------------------------------------------
// Ids

/** The core is the first branch; Problems and Init plan are the two after the facets. */
export const CORE_ID = "core";
export const FALLBACK_ID = "core:fallback";
export const PROBLEMS_ID = "problems";
export const INIT_ID = "init";

export const facetId = (facet: string): string => `facet:${facet}`;
export const selectorId = (facet: string, selector: Hex4): string => `selector:${facet}:${selector}`;
export const problemId = (id: string): string => `problem:${id}`;
export const coreFacetId = (facet: string): string => `core:facet:${facet}`;
export const coreSelectorId = (facet: string, selector: Hex4): string => `core:selector:${facet}:${selector}`;
export const areaId = (area: Area): string => `area:${area}`;

/** The facet a node id names, or null when it isn't a card's. */
export function facetOfId(id: string): string | null {
  return id.startsWith("facet:") ? id.slice("facet:".length) : null;
}

/** Whether a node id is the core's: the group, the fallback, a core facet or one of its selectors. */
export function isCoreId(id: string): boolean {
  return id === CORE_ID || id.startsWith("core:");
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
  /** The Core group: the diamond's fixed part. */
  | { kind: "core"; label: string }
  /** The proxy's fallback and how many selectors it routes. */
  | { kind: "fallback"; label: string; routed: number }
  /** A core facet (DiamondLoupeFacet, ERC165Facet), named as a card would be, though it's never one. */
  | { kind: "coreFacet"; facet: string; label: string; description: string; count: string; known: boolean }
  /** An area's group of placed facets ("DeFi"), named with how many it holds. */
  | { kind: "area"; area: Area; label: string; name: string; count: number }
  /** `area`: the id of the group it sits in; none while the catalog doesn't know the facet. */
  | { kind: "facet"; facet: string; label: string; description: string; count: string; known: boolean; area?: string }
  | { kind: "selector"; facet: string; view: PinView }
  | { kind: "problems"; label: string; count: number }
  | { kind: "problem"; problem: Problem; label: string }
  | { kind: "init"; label: string; summary: string }
  | { kind: "step"; step: InitStepView; label: string }
  | { kind: "sequence"; bundle: string; module: string; position: number; label: string };

export type Structure = {
  nodes: TreeNode[];
  meta: ReadonlyMap<string, StructureMeta>;
  /** Card ids in tree order, for focus after a delete. The core's facets aren't cards. */
  facets: string[];
  /** The area groups' ids, in tree order. */
  areas: string[];
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

/** "Fallback · 5 routed", the core cell's words: short enough for the 240 px pane. */
export function fallbackLabel(routed: number): string {
  return `Fallback · ${routed} routed`;
}

/** What a facet's row shares with a core facet's: the card's name, connections and count. */
type FacetWords = { label: string; description: string; count: string };

/**
 * The tree: the core, then one group per area (alphabetical by name, as the catalog lists them) holding its
 * cards in recipe order with their selectors, then any card the catalog doesn't know, then Problems, then
 * Init plan.
 */
export function buildStructure({ recipe, catalog, analysis, plan }: StructureInput): Structure {
  const meta = new Map<string, StructureMeta>();
  const nodes: TreeNode[] = [];
  const excluded = new Set(recipe.exclude);
  const facets: string[] = [];
  const areas: string[] = [];

  /**
   * A facet's row as its card reads: its name, count, connections and pins, whatever its size on the sheet.
   * Registers the selector rows' meta and returns the node with them as children, plus the card's words.
   */
  const facetRow = (facet: Facet, from: Catalog, id: string, selectorIdOf: (hex: Hex4) => string): { node: TreeNode; words: FacetWords } => {
    const card = cardView({
      facet, catalog: from, slice: cardAnalysis(analysis, facet), excluded, placed: recipe.facets,
      pins: "right", expanded: true, compact: false, metrics: layoutMetrics,
    });
    const children = card.all.map((view): TreeNode => {
      const child = selectorIdOf(view.selector);
      meta.set(child, { kind: "selector", facet: facet.name, view });
      return { id: child, label: view.signature };
    });
    return {
      node: { id, label: facet.name, ...(children.length > 0 ? { children } : {}) },
      words: { label: card.name, description: card.connections, count: card.count },
    };
  };

  // The core: the fallback, then each core facet in the recipe (CORE_FACETS order) with its selectors. Always
  // present, since the fallback is; without a catalog the facets list by name.
  const routed = analysis.stats.routed;
  meta.set(FALLBACK_ID, { kind: "fallback", label: fallbackLabel(routed), routed });
  const core: TreeNode[] = [{ id: FALLBACK_ID, label: "Fallback" }];
  for (const name of CORE_FACETS.filter((facet) => recipe.facets.includes(facet))) {
    const id = coreFacetId(name);
    const facet = catalog?.facets.find((f) => f.name === name);
    if (!catalog || !facet) {
      meta.set(id, { kind: "coreFacet", facet: name, label: name, description: "", count: "", known: false });
      core.push({ id, label: name });
      continue;
    }
    const row = facetRow(facet, catalog, id, (hex) => coreSelectorId(name, hex));
    meta.set(id, { kind: "coreFacet", facet: name, ...row.words, known: true });
    core.push(row.node);
  }
  meta.set(CORE_ID, { kind: "core", label: "Core" });
  nodes.push({ id: CORE_ID, label: "Core", children: core });

  const groups = new Map<Area, TreeNode[]>();
  const unknown: TreeNode[] = [];
  for (const name of recipe.facets) {
    if (isCoreFacet(name)) continue;
    const id = facetId(name);
    const facet = catalog?.facets.find((f) => f.name === name);
    if (!catalog || !facet) {
      meta.set(id, { kind: "facet", facet: name, label: name, description: "", count: "", known: false });
      unknown.push({ id, label: name });
      continue;
    }
    const row = facetRow(facet, catalog, id, (hex) => selectorId(name, hex));
    meta.set(id, { kind: "facet", facet: name, ...row.words, known: true, area: areaId(facet.area) });
    const group = groups.get(facet.area);
    if (group) group.push(row.node);
    else groups.set(facet.area, [row.node]);
  }
  const byName = [...groups.keys()].sort((a, b) => AREA_LABELS[a].localeCompare(AREA_LABELS[b], "en"));
  for (const area of byName) {
    const children = groups.get(area) ?? [];
    const id = areaId(area);
    const name = AREA_LABELS[area];
    meta.set(id, { kind: "area", area, name, label: `${name}, ${plural(children.length, "facet")}`, count: children.length });
    nodes.push({ id, label: name, children });
    areas.push(id);
    facets.push(...children.map((child) => child.id));
  }
  nodes.push(...unknown);
  facets.push(...unknown.map((node) => node.id));

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

  return { nodes, meta, facets, areas };
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
