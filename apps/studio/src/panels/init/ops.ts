/**
 * The init editor's document edits that core has no op for (contracts §3.4 lists none): confirming an address
 * that came from a link or a file (LINK-01), and applying Flow 17's mechanism change with its cards and its
 * From-link marks carried over. Pure `EditOp`s: the caller applies each as one undo step.
 */
import type {
  Address, Analysis, Arg, Catalog, EditResult, InitStep, LayoutMetrics, Point, Project, Recipe, Sizes,
} from "@lattice-studio/core";
import {
  analyze, cardSize, contestedSelectors, formatAddress, freeSlot, isNotImplemented, normalizeRecipe, setInitArg,
} from "@lattice-studio/core";
import { argAt, sameArg } from "./field-value";
import { addressAt, sameAddress } from "./init-paths";

function unchanged(project: Project, summary: string): EditResult {
  return { project, changed: false, summary };
}

/** LINK-01's Confirm address…: the argument at `path` counts as confirmed (spec L466, L504). */
export function confirmAddressOp(path: string, label: string): (project: Project) => EditResult {
  return (project) => {
    const source = project.provenance[path];
    if (source === undefined) return unchanged(project, `${label} didn't come from a link or a file.`);
    if (source === "confirmed") return unchanged(project, `${label} is already confirmed.`);
    return {
      project: { ...project, provenance: { ...project.provenance, [path]: "confirmed" } },
      changed: true,
      summary: `Confirmed ${label}`,
    };
  };
}

/** How far a provenance mark is trusted: least first. */
const TRUST: Readonly<Record<Project["provenance"][string], number>> = { link: 0, file: 1, confirmed: 2 };

const STEP_KEY =/^steps\[(0|[1-9][0-9]*)\]((?:\.|\[).*)?$/;

function stepsOf(recipe: Recipe): readonly InitStep[] {
  return recipe.init.kind === "steps" ? recipe.init.steps : [];
}

/** `project` with `labels`, the key left out when there are none (a project file without names stays as it was). */
function withLabels(project: Project, labels: Readonly<Record<string, string>>): Project {
  const { labels: _old, ...rest } = project;
  return Object.keys(labels).length > 0 ? { ...rest, labels: { ...labels } } : rest;
}

/** An address with the ENS name it came from, as the console writes it (spec L683: the ENS name first when known). */
export function labeledAddress(name: string, address: Address): string {
  return formatAddress(address, { ens: name });
}

/**
 * An address field's commit (spec L462): the value, and the ENS name it was resolved from kept as its label (or,
 * with `name` null, no label), as one edit, so one undo step. `label` is the field's ("Safe"). A name that
 * resolved to the address the field already holds only adds the label.
 */
export function setAddressOp(
  catalog: Catalog, path: string, value: Arg, name: string | null, label: string,
): (project: Project) => EditResult {
  return (project) => {
    const set = setInitArg(project, catalog, path, value);
    const before = project.labels?.[path] ?? null;
    const unchangedValue = !set.changed && typeof value === "string" && sameAddress(addressAt(project.recipe.init, path), value);
    if (!set.changed && !(unchangedValue && name !== before)) return set;
    // Core's set drops the path's label with the old value, so the name is written back even when it is the same one.
    const { [path]: _dropped, ...others } = set.project.labels ?? {};
    const labels = name === null ? others : { ...others, [path]: name };
    const next = withLabels(set.project, labels);
    if (name === null || typeof value !== "string") return { project: next, changed: true, summary: set.summary };
    return { project: next, changed: true, summary: `Set ${label} to ${labeledAddress(name, value as Address)}` };
  };
}

/** Which new step each old step became: the first unclaimed step of the same spec, in order. */
function stepMoves(before: Recipe, after: Recipe): Map<number, number> {
  const oldSteps = stepsOf(before);
  const newSteps = stepsOf(after);
  const taken = new Set<number>();
  const moved = new Map<number, number>();
  oldSteps.forEach((step, i) => {
    const j = newSteps.findIndex((candidate, k) => !taken.has(k) && candidate.spec === step.spec);
    if (j >= 0) {
      taken.add(j);
      moved.set(i, j);
    }
  });
  return moved;
}

/**
 * ENS labels keyed by the old recipe's paths, moved to the new recipe's (spec L462). A label stays with the address
 * it names: where its step now sits if the argument kept that address, else on the argument the change carried the
 * address to. A label whose address is gone is dropped, so it can never name another address.
 */
export function remapLabels(labels: Readonly<Record<string, string>>, before: Recipe, after: Recipe): Record<string, string> {
  const moved = stepMoves(before, after);
  const out: Record<string, string> = {};
  const carried: { address: string; name: string }[] = [];
  for (const [key, name] of Object.entries(labels)) {
    const address = addressAt(before.init, key);
    if (address === null) continue;
    const match = STEP_KEY.exec(key);
    const to = match ? moved.get(Number(match[1])) : undefined;
    const target = !match ? key : to === undefined ? null : `steps[${to}]${match[2] ?? ""}`;
    if (target !== null && sameAddress(addressAt(after.init, target), address)) out[target] = name;
    else carried.push({ address, name });
  }
  for (const leaf of leaves(stepsOf(after))) {
    if (out[leaf.path] !== undefined || typeof leaf.value !== "string") continue;
    const hit = carried.find((c) => sameAddress(c.address, leaf.value as string));
    if (hit) out[leaf.path] = hit.name;
  }
  return out;
}

/** Every argument under the steps, by path: "steps[1].admin", "steps[0].p.asset". */
function leaves(steps: readonly InitStep[]): { path: string; value: Arg }[] {
  const out: { path: string; value: Arg }[] = [];
  const walk = (at: string, value: Arg) => {
    if (typeof value === "object" && value !== null && !Array.isArray(value) && !("$ref" in value)) {
      for (const [key, inner] of Object.entries(value)) walk(`${at}.${key}`, inner);
    } else {
      out.push({ path: at, value });
    }
  };
  steps.forEach((step, i) => {
    for (const [key, value] of Object.entries(step.args)) walk(`steps[${i}].${key}`, value);
  });
  return out;
}

/**
 * Provenance keyed by the old recipe's paths, moved to the new recipe's. A step that survives keeps its marks
 * wherever it now sits, as long as the argument itself didn't change (a value the dialog wrote wasn't read from a
 * link). A literal address the change carried into another step (the admin SafeDiamondCutInit had, now
 * AccessControlInit's) keeps its mark there, so a From link address never loses LINK-01 by changing hands.
 */
export function remapProvenance(provenance: Project["provenance"], before: Recipe, after: Recipe): Project["provenance"] {
  const oldSteps = stepsOf(before);
  const newSteps = stepsOf(after);
  const moved = stepMoves(before, after);
  const out: Project["provenance"] = {};
  const carried: { value: Arg; source: Project["provenance"][string] }[] = [];
  for (const [key, source] of Object.entries(provenance)) {
    const match = STEP_KEY.exec(key);
    if (!match) {
      out[key] = source;
      continue;
    }
    const from = Number(match[1]);
    const to = moved.get(from);
    const oldStep = oldSteps[from];
    if (!oldStep) continue;
    const rest = match[2] ?? "";
    const keys = rest.split(".").filter((k) => k !== "");
    const oldValue = argAt(oldStep.args, keys);
    const newStep = to === undefined ? undefined : newSteps[to];
    if (to !== undefined && newStep && (keys.length === 0 || sameArg(oldValue, argAt(newStep.args, keys)))) {
      out[`steps[${to}]${rest}`] = source;
    } else if (typeof oldValue === "string" && oldValue !== "") {
      carried.push({ value: oldValue, source });
    }
  }
  for (const leaf of leaves(newSteps)) {
    if (out[leaf.path] !== undefined) continue;
    // When one address carried several marks (admin confirmed, safe still From link), the least trusted wins:
    // a mark must never turn into "confirmed" by changing hands.
    const marks = carried.filter((c) => sameArg(c.value, leaf.value)).map((c) => c.source);
    const mark = marks.sort((a, b) => TRUST[a] - TRUST[b])[0];
    if (mark) out[leaf.path] = mark;
  }
  return out;
}

function analysisOf(recipe: Recipe, catalog: Catalog): Analysis | null {
  try {
    return analyze(recipe, catalog);
  } catch (error) {
    if (isNotImplemented(error)) return null;
    throw error;
  }
}

/**
 * The layout once `after`'s facets replace `before`'s: removed facets' cards go, and each newly placed facet
 * lands where a removed one stood (the first new member takes the old member's place), else beside the sheet's
 * first card, moved to the nearest free slot so nothing stacks (spec L425).
 */
export function remapLayout(
  project: Project, after: Recipe, catalog: Catalog, metrics: LayoutMetrics,
): Project["layout"] {
  const keep = new Set(after.facets);
  const removed = project.recipe.facets.filter((name) => !keep.has(name));
  const layout: Project["layout"] = {};
  for (const [name, entry] of Object.entries(project.layout)) if (keep.has(name)) layout[name] = { ...entry };
  const placed = after.facets.filter((name) => layout[name] === undefined);
  if (placed.length === 0) return layout;

  const analysis = analysisOf(after, catalog);
  const sizeOf = (name: string, expanded: boolean, pins: "left" | "right") => {
    const facet = catalog.facets.find((f) => f.name === name);
    if (!facet) return { width: metrics.cardWidth, height: metrics.headerHeight + metrics.footerHeight };
    const size = cardSize(facet, { metrics, expanded, pins, compact: false, contested: analysis ? contestedSelectors(analysis, name) : [] });
    return { width: size.width, height: size.height };
  };
  const sizes: Sizes = {};
  for (const [name, entry] of Object.entries(layout)) sizes[name] = sizeOf(name, entry.expanded === true, entry.pins);

  const anchors: Point[] = removed.flatMap((name) => {
    const entry = project.layout[name];
    return entry ? [{ x: entry.x, y: entry.y }] : [];
  });
  const first = Object.values(project.layout)[0];
  const fallback: Point = first ? { x: first.x, y: first.y } : { x: 12 * metrics.grid, y: 12 * metrics.grid };
  placed.forEach((name, i) => {
    const size = sizeOf(name, false, "right");
    const at = anchors[i] ?? anchors[0] ?? fallback;
    const slot = freeSlot(layout, sizes, at, size, metrics);
    layout[name] = { x: slot.x, y: slot.y, pins: "right" };
    sizes[name] = size;
  });
  return layout;
}

/** Flow 17's Apply: the new recipe, its cards and the From-link marks that still hold, as one edit. */
export function applyMechanismOp(
  next: Recipe, catalog: Catalog, metrics: LayoutMetrics, summary: string,
): (project: Project) => EditResult {
  return (project) => {
    const recipe = normalizeRecipe(next, catalog);
    const moved: Project = {
      ...project,
      recipe,
      layout: remapLayout(project, recipe, catalog, metrics),
      provenance: remapProvenance(project.provenance, project.recipe, recipe),
    };
    return {
      project: project.labels ? withLabels(moved, remapLabels(project.labels, project.recipe, recipe)) : moved,
      changed: true,
      summary,
    };
  };
}
