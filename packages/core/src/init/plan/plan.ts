/**
 * The init plan, derived from the recipe alone (spec L457-L469, R10, R11, PA L17 bug 9): a bundle is one locked
 * step with its read-only `sequence`; step inits keep the recipe's order and get the automatic ERC-165 step
 * unless one of them registers the interfaces itself; none has no steps.
 */
import type { AutoOrderFn, PlanInitFn } from "../../model/api";
import type { Catalog, InitSpec } from "../../model/catalog";
import { canonicalJson } from "../../canonical/json";
import type { InitStepView } from "../../model/init";
import type { Arg } from "../../model/recipe";
import { fieldsOf, judgeArg } from "./fields";
import { findSpec, hasUpgradeMechanism, leaves, modulesOf } from "./specs";

/** The path of the automatic ERC-165 step. */
export const AUTO_STEP_PATH = "auto";

/** True when an argument still holds the template's example: plain value equality (C4a brief, Watch out). */
export function isExample(example: unknown, value: Arg | undefined): boolean {
  if (example === undefined || value === undefined) return false;
  return canonicalJson(example) === canonicalJson(value);
}

function stepView(path: string, index: number, name: string, spec: InitSpec | undefined, args: Record<string, Arg>, locked: boolean): InitStepView {
  if (!spec) return { path, index, spec: name, contract: name, fn: "", locked, args, fields: [], missing: [], examples: [] };
  const fields = fieldsOf(spec, path);
  const missing: string[] = [];
  const examples: string[] = [];
  for (const { field, value } of leaves(fields, args)) {
    const judged = judgeArg(field, value, {});
    if (!judged.ok) missing.push(judged.path);
    if (isExample(field.example, value)) examples.push(field.path);
  }
  return { path, index, spec: spec.name, contract: spec.contract, fn: spec.fn, locked, args, fields, missing, examples };
}

function automaticStep(index: number, which: "initUpgradeable" | "initImmutable", catalog: Catalog): InitStepView {
  const name = `DiamondIntrospectionInit.${which}`;
  const spec = findSpec(catalog, name);
  return {
    path: AUTO_STEP_PATH,
    index,
    spec: name,
    contract: spec?.contract ?? "DiamondIntrospectionInit",
    fn: spec?.fn ?? `${which}()`,
    automatic: which,
    locked: true,
    args: {},
    fields: [],
    missing: [],
    examples: [],
  };
}

/** The recipe's init as the inspector shows it. */
export const planInit: PlanInitFn = (recipe, catalog) => {
  const init = recipe.init;
  if (init.kind === "none") return { kind: "none", steps: [] };
  if (init.kind === "bundle") {
    const spec = findSpec(catalog, init.spec);
    const step = stepView("bundle", 0, init.spec, spec, init.args, true);
    return spec?.sequence ? { kind: "bundle", steps: [step], sequence: [...spec.sequence] } : { kind: "bundle", steps: [step] };
  }
  const steps = init.steps.map((step, i) => stepView(`steps[${i}]`, i, step.spec, findSpec(catalog, step.spec), step.args, false));
  const registers = init.steps.some((step) => findSpec(catalog, step.spec)?.registersInterfaces === true);
  if (!registers) {
    const which = hasUpgradeMechanism(recipe.facets, catalog) ? "initUpgradeable" : "initImmutable";
    steps.push(automaticStep(steps.length, which, catalog));
  }
  return { kind: "steps", steps };
};

/**
 * For each step, the steps that must run before it: under `after: [M]`, every other step that initializes M,
 * unless the step initializes M itself (contracts §4, overlay semantics decided 2026-09-23).
 */
export function predecessors(specs: readonly (InitSpec | undefined)[]): Set<number>[] {
  const modules = specs.map(modulesOf);
  return specs.map((spec, i) => {
    const before = new Set<number>();
    for (const module of spec?.after ?? []) {
      if (modules[i]?.has(module)) continue;
      modules.forEach((set, j) => {
        if (j !== i && set.has(module)) before.add(j);
      });
    }
    return before;
  });
}

/**
 * A stable topological sort: at each position, the earliest remaining step whose predecessors have all run.
 * An order that already satisfies every constraint comes back unchanged. Steps caught in a cycle keep their
 * relative order after everything that can be placed.
 */
export const autoOrder: AutoOrderFn = (steps, catalog) => {
  const before = predecessors(steps.map((step) => findSpec(catalog, step.spec)));
  const placed = new Set<number>();
  const order: number[] = [];
  while (order.length < steps.length) {
    const remaining = steps.map((_, i) => i).filter((i) => !placed.has(i));
    const next = remaining.find((i) => [...(before[i] ?? [])].every((j) => placed.has(j))) ?? remaining[0];
    if (next === undefined) break;
    placed.add(next);
    order.push(next);
  }
  return order.flatMap((i) => {
    const step = steps[i];
    return step ? [step] : [];
  });
};
