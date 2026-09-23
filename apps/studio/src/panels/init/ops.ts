/**
 * The init editor's document edits that core has no op for (contracts §3.4 lists none): confirming an address
 * that came from a link or a file (LINK-01), and applying Flow 17's mechanism change with its cards and its
 * From-link marks carried over. Pure `EditOp`s: the caller applies each as one undo step.
 */
import type {
  Analysis, Arg, Catalog, EditResult, InitStep, LayoutMetrics, Point, Project, Recipe, Sizes,
} from "@lattice-studio/core";
import { analyze, cardSize, contestedSelectors, freeSlot, isNotImplemented, normalizeRecipe } from "@lattice-studio/core";
import { argAt, sameArg } from "./field-value";

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

const STEP_KEY = /^steps\[(0|[1-9][0-9]*)\]((?:\.|\[).*)?$/;

function stepsOf(recipe: Recipe): readonly InitStep[] {
  return recipe.init.kind === "steps" ? recipe.init.steps : [];
}

/**
 * Provenance keyed by the old recipe's paths, moved to the new recipe's: a step that survives keeps its marks
 * wherever it now sits, as long as the argument itself didn't change (a value the change wrote wasn't read from
 * a link). Marks on steps that went away go with them.
 */
export function remapProvenance(provenance: Project["provenance"], before: Recipe, after: Recipe): Project["provenance"] {
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
  const out: Project["provenance"] = {};
  for (const [key, source] of Object.entries(provenance)) {
    const match = STEP_KEY.exec(key);
    if (!match) {
      out[key] = source;
      continue;
    }
    const from = Number(match[1]);
    const to = moved.get(from);
    const oldStep = oldSteps[from];
    const newStep = to === undefined ? undefined : newSteps[to];
    if (to === undefined || !oldStep || !newStep) continue;
    const rest = match[2] ?? "";
    const keys = rest.split(".").filter((k) => k !== "");
    if (keys.length > 0 && !sameArg(argAt(oldStep.args, keys) as Arg | undefined, argAt(newStep.args, keys) as Arg | undefined)) continue;
    out[`steps[${to}]${rest}`] = source;
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
    return {
      project: {
        ...project,
        recipe,
        layout: remapLayout(project, recipe, catalog, metrics),
        provenance: remapProvenance(project.provenance, project.recipe, recipe),
      },
      changed: true,
      summary,
    };
  };
}
