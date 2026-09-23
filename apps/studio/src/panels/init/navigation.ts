/**
 * Showing the init plan in the inspector (Flow 7 step 1, IR L125), and finding fields in it. Light enough for the
 * entry chunk: the commands use it, and it imports no component.
 */
import type { Catalog, FieldModel, InitPlan, Recipe } from "@lattice-studio/core";
import { isNotImplemented, planInit } from "@lattice-studio/core";
import { session } from "@/contracts";

/**
 * Opens the inspector on the init plan. `focus` is an argument path ("bundle.p.asset"), a step path
 * ("steps[2]"), "examples" or "authority"; the editor moves focus there. Each call makes a new view, so asking
 * again for the same field focuses it again.
 */
export function showInitPlan(focus?: string): void {
  const view = focus === undefined ? ({ kind: "init" } as const) : ({ kind: "init", focus } as const);
  session.set((s) => ({ panes: { ...s.panes, narrow: "inspector", inspector: { ...s.panes.inspector, open: true, view } } }));
}

/** The plan, or none while C4a's planner can't run. */
export function planOf(recipe: Recipe, catalog: Catalog): InitPlan {
  try {
    return planInit(recipe, catalog);
  } catch (error) {
    if (isNotImplemented(error)) return { kind: "none", steps: [] };
    throw error;
  }
}

/** Every field of the plan's editable steps, tuple components included, in form order. */
export function planFields(plan: InitPlan): FieldModel[] {
  const out: FieldModel[] = [];
  const walk = (fields: readonly FieldModel[]) => {
    for (const field of fields) {
      out.push(field);
      if (field.components) walk(field.components);
    }
  };
  for (const step of plan.steps) if (step.automatic === undefined) walk(step.fields);
  return out;
}

/** The field at `path`, if the plan has one. */
export function planField(plan: InitPlan, path: string): FieldModel | undefined {
  return planFields(plan).find((field) => field.path === path);
}

/** The first required argument that is missing or breaks its rule: where Fill in goes (spec L411). */
export function firstMissing(plan: InitPlan): string | null {
  for (const step of plan.steps) {
    const path = step.missing[0];
    if (path !== undefined) return path;
  }
  return null;
}
