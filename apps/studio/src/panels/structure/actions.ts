/**
 * What the Structure tree's keys and clicks do (IR L90-L97). Everything runs through the command registry, so
 * a command that can't run (read-only, or its owner not built yet) logs and announces why; the tree never
 * edits the document itself. The core's rows select the core (`core.select`): its facets are never cards.
 */
import type { CommandRef, Recipe } from "@lattice-studio/core";
import { CORE_FACETS } from "@lattice-studio/core";
import { announce, commandRef, isPlaceholder, log, runCommand, session, type CommandSource } from "@/contracts";
import { moveTarget, tooltipText, type StructureMeta } from "./structure-model";

/** Says a key that changed nothing, in the console and the status region. */
export function say(text: string): void {
  log({ tag: "Note", text });
  announce(text);
}

function run(ref: CommandRef, source: CommandSource): void {
  void runCommand(ref, source);
}

/**
 * Centers a facet's card (spec L483). Only once the sheet can: until then selecting is all a click does, so a
 * placeholder's reason isn't logged on every click.
 */
export function locate(facet: string): void {
  if (!isPlaceholder("sheet.locate")) run({ id: "sheet.locate", args: { facet } }, "api");
}

/**
 * Right click or the menu key on a facet: its menu acts on the selection, so a facet outside the selection
 * becomes the selection first (Move to… moves the selection).
 */
export function selectForMenu(facet: string): void {
  if (!session.get().selection.includes(facet)) session.set({ selection: [facet] });
}

/** Selects the core, the diamond's fixed part (Enter or Space on the Core group or its fallback). */
export function selectCore(source: CommandSource): void {
  run(commandRef("core.select"), source);
}

/** Enter or double-click (IR L92-L97). Returns false when the tree should do its own thing (a branch). */
export function activate(meta: StructureMeta, source: CommandSource): boolean {
  switch (meta.kind) {
    case "facet":
    case "coreFacet":
      run({ id: "inspector.show", args: { facet: meta.facet } }, source);
      return true;
    case "core":
    case "fallback":
      selectCore(source);
      return true;
    case "selector":
      run({ id: "inspector.focusSelectors", args: { facet: meta.facet } }, source);
      return true;
    case "problem":
      // As F8 does: focus the problem's note (S4c).
      run({ id: "problem.focus", args: { problemId: meta.problem.id } }, source);
      return true;
    case "init":
      run({ id: "init.open" }, source);
      return true;
    case "step": {
      const { step } = meta;
      run(step.automatic ? { id: "init.open" } : { id: "init.open", args: { focus: step.path } }, source);
      return true;
    }
    case "sequence":
      run({ id: "init.open", args: { focus: "bundle" } }, source);
      return true;
    case "problems":
      return false;
  }
}

/**
 * Space. A selector does what its pin's click does (Flow 6); a seam, or a selector not checked yet, says why
 * it does nothing. The core's rows select the core. Facets keep the tree's own Space (toggle selection);
 * branches toggle. Returns whether Space was taken.
 */
export function pressSpace(meta: StructureMeta): boolean {
  switch (meta.kind) {
    case "selector":
      if (meta.view.action) run(meta.view.action, "keys");
      else say(tooltipText(meta.view.tooltip));
      return true;
    case "core":
    case "fallback":
    case "coreFacet":
      selectCore("keys");
      return true;
    case "facet":
    case "problems":
      return false;
    default:
      return activate(meta, "keys");
  }
}

/**
 * Alt + ↑ (-1) or Alt + ↓ (+1) on an init step: one `init.moveStep`, so one undo step per press (spec L763).
 * A bundle, its read-only order and the automatic step say why they don't move.
 */
export function moveStep(meta: StructureMeta, recipe: Recipe, delta: -1 | 1): boolean {
  if (meta.kind === "sequence") {
    say(`${meta.bundle} is a bundle: its order is fixed.`);
    return true;
  }
  if (meta.kind !== "step") return false;
  const target = moveTarget(meta.step, recipe, delta);
  if (target.ok) run({ id: "init.moveStep", args: { path: target.path, to: target.to } }, "keys");
  else say(target.reason);
  return true;
}

/** Whether a row is the core's: Delete on it asks to remove the core, which `facet.remove` refuses, saying why. */
export function isCoreMeta(meta: StructureMeta): boolean {
  return meta.kind === "core" || meta.kind === "fallback" || meta.kind === "coreFacet";
}

/**
 * The facets Delete removes: on a facet, the selection when it's in it, else that facet; on the core, the
 * core's facets (so the refusal names them); elsewhere in the tree, the selection (IR L25).
 */
export function facetsToRemove(meta: StructureMeta, selection: readonly string[]): string[] {
  if (meta.kind === "facet") return selection.includes(meta.facet) ? [...selection] : [meta.facet];
  if (meta.kind === "coreFacet") return [meta.facet];
  if (meta.kind === "core" || meta.kind === "fallback") return [...CORE_FACETS];
  return [...selection];
}
