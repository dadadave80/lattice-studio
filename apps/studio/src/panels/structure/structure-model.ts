/**
 * The Structure tree's content (spec L747, IR L90-L97): the sheet's facets with their selectors, a Problems
 * branch and an Init plan branch, as `Tree` nodes plus what each node is. Pure: the panel renders this and
 * decides nothing about a selector's state, a name or a step's moves itself, so every rule is unit-tested.
 *
 * A facet's name and description mirror its card's (spec L745-L746): "ERC20, 9 selectors, 4 served by other
 * facets", then its connections in words. A selector's state and what Space does mirror its pin (Flow 6,
 * IR L104).
 */
import type {
  Analysis, Catalog, CommandRef, Facet, Hex4, InitPlan, InitStepView, Problem, Recipe, Route, Severity,
} from "@lattice-studio/core";
import { contestedSelectors, formatCount, plural } from "@lattice-studio/core";
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

// ---------------------------------------------------------------------------------------------------------
// Selectors (pins)

/** A pin's state (IR L104): routed here, not in the diamond, served elsewhere, contested, owner by default, seam. */
export type PinState = "routed" | "excluded" | "elsewhere" | "contested" | "default" | "seam";

export type SelectorView = {
  selector: Hex4;
  signature: string;
  /** "transfer". */
  name: string;
  state: PinState;
  /** Who serves it, when that's another facet. */
  owner?: string;
  /** The visible state after the name: the hex, "→ GovernedVault", "stays on GovernedVault". */
  mark: string;
  /** Flow 6's tooltip: what Space does, or for a seam why it stays. */
  tooltip: string;
  /** The row's accessible name: signature, hex and state in words (as the pin's). */
  label: string;
  /** What Space runs, as a pin click does; null on a seam, which offers no route. */
  action: CommandRef | null;
};

/** "transfer(address,uint256)" → "transfer". */
export function functionName(signature: string): string {
  const open = signature.indexOf("(");
  return open < 0 ? signature : signature.slice(0, open);
}

function joinWith(items: readonly string[], word: "and" | "or"): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} ${word} ${items.at(-1) ?? ""}`;
}

function seamReason(catalog: Catalog, selector: Hex4, owner: string): string | undefined {
  return catalog.seams.find((s) => s.selector === selector && s.anyOf.includes(owner))?.reason;
}

/** One selector of a placed facet: its state, words and action, as its pin on the card (Flow 6). */
export function selectorView(args: {
  facet: string;
  selector: { hex: Hex4; signature: string };
  route: Route | undefined;
  excluded: boolean;
  catalog: Catalog;
}): SelectorView {
  const { facet, selector, route, excluded, catalog } = args;
  const { hex, signature } = selector;
  const base = { selector: hex, signature, name: functionName(signature) };
  const described = (state: string) => `${signature} ${hex}, ${state}`;

  if (excluded) {
    return {
      ...base, state: "excluded", mark: hex,
      tooltip: "Not in the diamond. Click to route here.",
      label: described("not in the diamond"),
      action: { id: "selector.include", args: { selector: hex, facet } },
    };
  }
  const owner = route?.owner;
  if (route?.via === "seam" && owner !== undefined) {
    const reason = seamReason(catalog, hex, owner);
    return {
      ...base, state: "seam", owner, mark: owner === facet ? hex : `stays on ${owner}`,
      tooltip: `Seam: stays on ${owner}${reason ? ` because its version ${reason}` : ""}.`,
      label: described(`seam: stays on ${owner}`),
      action: null,
    };
  }
  if (owner === undefined) {
    const others = (route?.contenders ?? []).filter((c) => c !== facet);
    return {
      ...base, state: "contested", mark: hex,
      tooltip: `${others.length > 0 ? `Collides with ${joinWith(others, "and")}. ` : ""}Click to route here.`,
      label: described(others.length > 0 ? `contested with ${joinWith(others, "and")}` : "contested"),
      action: { id: "selector.route", args: { selector: hex, facet } },
    };
  }
  if (owner !== facet) {
    return {
      ...base, state: "elsewhere", owner, mark: `→ ${owner}`,
      tooltip: `Served by ${owner}. Click to route here instead.`,
      label: described(`served by ${owner}`),
      action: { id: "selector.route", args: { selector: hex, facet } },
    };
  }
  if (route?.via === "default") {
    // "Click to change": with one rival, routing to it; with more, the inspector's owner menu (spec L303, L437).
    const others = route.contenders.filter((c) => c !== facet);
    const [only] = others;
    return {
      ...base, state: "default", mark: hex,
      tooltip: "Owner by default. Click to change.",
      label: described("routes here, owner by default"),
      action: others.length === 1 && only !== undefined
        ? { id: "selector.route", args: { selector: hex, facet: only } }
        : { id: "inspector.focusSelectors", args: { facet } },
    };
  }
  return {
    ...base, state: "routed", mark: hex,
    tooltip: `\`${signature}\`: routes here. Click to leave it out of the diamond.`,
    label: described("routes here"),
    action: { id: "selector.exclude", args: { selector: hex } },
  };
}

// ---------------------------------------------------------------------------------------------------------
// Facets (cards)

function anchorsFacet(problem: Problem, facet: string): boolean {
  return problem.where.some((a) => (a.kind === "facet" || a.kind === "selector") && a.facet === facet);
}

function netMissing(problem: Problem, facet: string): boolean {
  const missing = problem.params["missing"];
  return problem.code === "NET-03" && Array.isArray(missing) && missing.includes(facet);
}

/** "ERC20, 9 selectors, 4 served by other facets" (spec L745), with the other counts when they're not zero. */
export function facetName(facet: string, pins: readonly SelectorView[]): string {
  const count = (state: PinState) => pins.filter((p) => p.state === state).length;
  const elsewhere = count("elsewhere") + pins.filter((p) => p.state === "seam" && p.owner !== facet).length;
  const excluded = count("excluded");
  const contested = count("contested");
  const parts = [facet, plural(pins.length, "selector")];
  if (elsewhere > 0) parts.push(elsewhere === 1 ? "1 served by another facet" : `${elsewhere} served by other facets`);
  if (excluded > 0) parts.push(`${excluded} not in the diamond`);
  if (contested > 0) parts.push(`${contested} contested`);
  return parts.join(", ");
}

function firstPlaced(options: readonly string[], placed: ReadonlySet<string>, self: string): string | undefined {
  return options.find((o) => o !== self && placed.has(o));
}

/**
 * The facet's connections in words (spec L746), as its card describes them: "Needs ERC4626; collides with
 * AxelarGatewayAdapter on sendMessage; 1 blocker."
 */
export function facetConnections(args: {
  facet: Facet;
  catalog: Catalog;
  placed: readonly string[];
  analysis: Analysis;
  pins: readonly SelectorView[];
}): string {
  const { facet, catalog, analysis, pins } = args;
  const placed = new Set(args.placed);
  const parts: string[] = [];

  for (const req of facet.requires) {
    if (req.strength !== "hard") continue;
    const provider = firstPlaced(req.anyOf, placed, facet.name);
    parts.push(provider ? `needs ${provider}` : `needs ${joinWith(req.anyOf, "or")}, which isn't on the sheet`);
  }
  const dependents = catalog.facets
    .filter((f) => f.name !== facet.name && placed.has(f.name))
    .filter((f) => f.requires.some((r) => r.strength === "hard" && firstPlaced(r.anyOf, placed, f.name) === facet.name))
    .map((f) => f.name);
  if (dependents.length > 0) parts.push(`needed by ${joinWith(dependents, "and")}`);

  const rivals = new Map<string, string[]>();
  for (const selector of contestedSelectors(analysis, facet.name)) {
    const pin = pins.find((p) => p.selector === selector);
    for (const other of analysis.routing[selector]?.contenders ?? []) {
      if (other === facet.name || !pin) continue;
      rivals.set(other, [...(rivals.get(other) ?? []), pin.name]);
    }
  }
  for (const [other, names] of rivals) parts.push(`collides with ${other} on ${joinWith(names, "and")}`);

  const chains = new Set(
    analysis.problems.filter((p) => netMissing(p, facet.name)).map((p) => String(p.params["chain"] ?? "this chain")),
  );
  for (const chain of chains) parts.push(`not on ${chain}`);

  const own = analysis.problems.filter((p) => anchorsFacet(p, facet.name));
  const blockers = own.filter((p) => p.severity === "blocker").length;
  const warnings = own.filter((p) => p.severity === "warning").length;
  if (blockers > 0) parts.push(plural(blockers, "blocker"));
  if (warnings > 0) parts.push(plural(warnings, "warning"));

  if (parts.length === 0) return "";
  const text = parts.join("; ");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
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
  | { kind: "selector"; facet: string; view: SelectorView }
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
    const pins = facet.selectors.map((selector) =>
      selectorView({ facet: name, selector, route: analysis.routing[selector.hex], excluded: excluded.has(selector.hex), catalog }),
    );
    const routed = pins.filter((p) => p.state === "routed" || p.state === "default" || (p.state === "seam" && p.owner === name)).length;
    meta.set(id, {
      kind: "facet",
      facet: name,
      label: facetName(name, pins),
      description: facetConnections({ facet, catalog, placed: recipe.facets, analysis, pins }),
      count: formatCount(routed, pins.length),
      known: true,
    });
    const children = pins.map((view): TreeNode => {
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
