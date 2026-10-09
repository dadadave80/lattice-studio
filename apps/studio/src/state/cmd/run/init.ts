/**
 * What the init commands do (`../init.ts` defines them): set an argument, add a step, use a bundle, remove and move
 * steps, reorder them.
 */
import type { Arg, Catalog, EditResult, InitStep, Project } from "@lattice-studio/core";
import { addInitStep, autoOrder, lines, moveInitStep, removeInitStep, setInitArg, useInitBundle } from "@lattice-studio/core";
import type { CommandArgsOf, CommandContext } from "@/contracts";
import { fieldAt, showValue, stepIndex } from "../init";
import { combined, edit } from "../shared";

type SetArgArgs = CommandArgsOf<"init.setArg">;
type AddStepArgs = CommandArgsOf<"init.addStep">;
type UseBundleArgs = CommandArgsOf<"init.useBundle">;
type RemoveStepArgs = CommandArgsOf<"init.removeStep">;
type MoveStepArgs = CommandArgsOf<"init.moveStep">;

export function setArg(ctx: CommandContext, { path, value }: SetArgArgs): void {
  const catalog = ctx.catalog;
  if (!catalog) return;
  const field = fieldAt(ctx.project.recipe, catalog, path);
  edit((p) => setInitArg(p, catalog, path, value), {
    // The field's label, not C11's path summary: "Set Governor quorum to 4%." (spec L716).
    say: (r) => {
      if (!field) return [];
      const stored = fieldValue(r.project, path);
      return stored === undefined ? [] : [lines.fieldSet({ label: field.label, value: showValue(field, stored) })];
    },
  });
}

/** The stored argument at an init path, after normalization. */
function fieldValue(project: Project, path: string): Arg | undefined {
  const [head, ...fields] = path.split(".");
  const init = project.recipe.init;
  let args: Record<string, Arg> | undefined;
  if (head === "bundle" && init.kind === "bundle") args = init.args;
  const index = head === undefined ? null : stepIndex(head);
  if (index !== null && init.kind === "steps") args = init.steps[index]?.args;
  let current: Arg | undefined = args;
  for (const field of fields) {
    if (typeof current !== "object" || current === null || Array.isArray(current) || Object.hasOwn(current, "$ref")) return undefined;
    current = (current as Record<string, Arg>)[field];
  }
  return current;
}

export function addStep(ctx: CommandContext, { spec }: AddStepArgs): void {
  const catalog = ctx.catalog;
  if (!catalog) return;
  edit((p) => addInitStep(p, catalog, spec));
}

export function applyBundle(ctx: CommandContext, { spec }: UseBundleArgs): void {
  const catalog = ctx.catalog;
  if (!catalog) return;
  edit((p) => useInitBundle(p, catalog, spec));
}

export function removeStep(ctx: CommandContext, { path }: RemoveStepArgs): void {
  const catalog = ctx.catalog;
  if (!catalog) return;
  edit((p) => removeInitStep(p, catalog, path));
}

export function moveStep(ctx: CommandContext, { path, to }: MoveStepArgs): void {
  const catalog = ctx.catalog;
  const from = stepIndex(path);
  if (!catalog || from === null) return;
  edit((p) => moveInitStep(p, catalog, from, to), {
    // "Moved VaultCore to step 3, after ERC4626." (spec L717)
    say: (r) => {
      const init = r.project.recipe.init;
      if (init.kind !== "steps") return [];
      const moved = init.steps[to]?.spec;
      const after = to > 0 ? init.steps[to - 1]?.spec : undefined;
      return moved ? [lines.stepMoved({ spec: moved, step: to + 1, ...(after ? { after } : {}) })] : [];
    },
  });
}

/** The step order `autoOrder` gives, as moves one step at a time (so C11 remaps provenance on each). */
function reorder(project: Project, catalog: Catalog): EditResult {
  const init = project.recipe.init;
  if (init.kind !== "steps") {
    return { project, changed: false, summary: init.kind === "bundle" ? `${init.spec} is a bundle: its order is fixed.` : "The init plan has no steps to order." };
  }
  const target = autoOrder(init.steps, catalog);
  let next = project;
  for (let to = 0; to < target.length; to++) {
    const wanted = target[to];
    const current = next.recipe.init;
    if (!wanted || current.kind !== "steps") break;
    const from = current.steps.findIndex((step: InitStep) => step.spec === wanted.spec);
    if (from > to) next = moveInitStep(next, catalog, from, to).project;
  }
  return combined(project, next, next !== project, next !== project ? "Reordered the init steps" : "The init steps are already in order.");
}

export function reorderAuto(ctx: CommandContext): void {
  const catalog = ctx.catalog;
  if (!catalog) return;
  edit((p) => reorder(p, catalog));
}
