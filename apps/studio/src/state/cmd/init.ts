/**
 * Init commands (Flow 7, spec L457-L469): set an argument (`set <field> <value>`, IR L151), add a step
 * (INIT-04), use a bundle in place of the steps (INIT-04 for a bundle-only facet), remove a step (INIT-03's
 * Remove {A}), move one, and Reorder steps automatically (INIT-02). What they do is in `run/init.ts`, loaded after
 * the first paint.
 */
import type { Arg, Catalog, FieldModel, Recipe, Result } from "@lattice-studio/core";
import { formatAddress, formatDuration, isAddress, planInit, validateArg } from "@lattice-studio/core";
import { command, doc, getCatalog, type CommandArgsOf } from "@/contracts";
import { studioState } from "../runtime";
import { lazyRun } from "./lazy";
import { disabled, err, guard, isString, OK, ok, unquote } from "./shared";

type SetArgArgs = CommandArgsOf<"init.setArg">;
type AddStepArgs = CommandArgsOf<"init.addStep">;
type UseBundleArgs = CommandArgsOf<"init.useBundle">;
type RemoveStepArgs = CommandArgsOf<"init.removeStep">;
type MoveStepArgs = CommandArgsOf<"init.moveStep">;

/** Every field of the plan, tuple components included, with the spec of the step it belongs to. */
export function planFields(recipe: Recipe, catalog: Catalog): { spec: string; field: FieldModel }[] {
  const out: { spec: string; field: FieldModel }[] = [];
  const walk = (spec: string, fields: readonly FieldModel[]): void => {
    for (const field of fields) {
      out.push({ spec, field });
      if (field.components) walk(spec, field.components);
    }
  };
  for (const step of planInit(recipe, catalog).steps) {
    if (step.automatic === undefined) walk(step.spec, step.fields);
  }
  return out;
}

/** The field at `path`, if the plan has it. */
export function fieldAt(recipe: Recipe, catalog: Catalog, path: string): FieldModel | undefined {
  return planFields(recipe, catalog).find((f) => f.field.path === path)?.field;
}

/**
 * A field as typed in the console: its name (`quorumNumerator`), its label (`"Governor quorum"`) or one word of
 * the label (`quorum`), case-insensitively; `<step>.<field>` picks the step when a name repeats
 * (`erc20init.name`, IR L151).
 */
export function resolveField(recipe: Recipe, catalog: Catalog, typed: string): Result<FieldModel, string> {
  const token = unquote(typed).toLowerCase();
  const all = planFields(recipe, catalog).filter((f) => f.field.kind !== "tuple");
  const dot = token.indexOf(".");
  const scoped = dot > 0 ? all.filter((f) => f.spec.toLowerCase() === token.slice(0, dot)) : [];
  const pool = scoped.length > 0 ? scoped : all;
  const name = scoped.length > 0 ? token.slice(dot + 1) : token;
  const tries: ((f: FieldModel) => boolean)[] = [
    (f) => f.path.toLowerCase() === token,
    (f) => f.name.toLowerCase() === name,
    (f) => f.label.toLowerCase() === name,
    (f) => f.label.toLowerCase().split(/\s+/).includes(name),
  ];
  for (const test of tries) {
    const hits = pool.filter((f) => test(f.field));
    if (hits.length === 1 && hits[0]) return ok(hits[0].field);
    if (hits.length > 1) {
      const steps = [...new Set(hits.map((h) => h.spec))];
      const hint = steps.length > 1 ? ` Prefix the step: set ${steps[0]?.toLowerCase()}.${hits[0]?.field.name} <value>` : "";
      return err(`${unquote(typed)} matches ${hits.length} fields: ${hits.map((h) => h.field.label).join(", ")}.${hint}`);
    }
  }
  return err(`The init plan has no field ${unquote(typed)}.`);
}

/** A console value for `field`: references by name, booleans, and text as typed. */
export function argFromText(field: FieldModel, text: string): Arg {
  const value = unquote(text);
  const lower = value.toLowerCase();
  if (field.kind === "address") {
    if (lower === "self" || lower === "this diamond") return { $ref: "self" };
    if (lower === "deployer" || lower === "deploying account") return { $ref: "deployer" };
  }
  if (field.kind === "bool" && (lower === "true" || lower === "false")) return lower === "true";
  return value;
}

/** The value as "Set Governor quorum to 4%." shows it (spec L716): units, short addresses, references in words. */
export function showValue(field: FieldModel | undefined, value: Arg): string {
  if (typeof value === "boolean") return String(value);
  if (typeof value === "string") {
    if (isAddress(value)) return formatAddress(value);
    if (/^[0-9]+$/.test(value)) {
      if (field?.unit === "percent" || field?.kind === "percent") return `${value}%`;
      if (field?.unit === "seconds" || field?.kind === "duration") return formatDuration(value);
    }
    return value === "" ? "an empty string" : value;
  }
  if (!Array.isArray(value) && Object.hasOwn(value, "$ref")) return value.$ref === "self" ? "this diamond" : "the deploying account";
  return JSON.stringify(value);
}

const STEP = /^steps\[(0|[1-9][0-9]*)\]$/;

export function stepIndex(path: string): number | null {
  const m = STEP.exec(path);
  return m?.[1] === undefined ? null : Number(m[1]);
}

function specAt(recipe: Recipe, path: string): string | undefined {
  if (path === "bundle") return recipe.init.kind === "bundle" ? recipe.init.spec : undefined;
  const index = stepIndex(path);
  return index === null || recipe.init.kind !== "steps" ? undefined : recipe.init.steps[index]?.spec;
}

/** `{ $ref: "self" }`: "This diamond" (spec L333). */
function isSelfRef(value: Arg | undefined): boolean {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.hasOwn(value, "$ref") && (value as { $ref: string }).$ref === "self";
}

export const setArgCommand = command<SetArgArgs>({
  id: "init.setArg",
  // `verb: "oneAdmin"` reads "Use one admin" (INIT-03, spec L329); a `{ $ref: "self" }` value reads
  // Use "This diamond" (AUTH-02, spec L333) whether or not a verb is given. Otherwise, Set {field label}.
  title: ({ path, value, verb }) => {
    if (verb === "oneAdmin") return "Use one admin";
    if (isSelfRef(value)) return 'Use "This diamond"';
    const catalog = getCatalog();
    const field = catalog ? fieldAt(doc.get().recipe, catalog, path) : undefined;
    return `Set ${field?.label ?? path}`;
  },
  category: "Build",
  console: {
    verb: "set",
    syntax: "set <field> <value>",
    parse: (argv) => {
      const [typed, ...rest] = argv;
      if (typed === undefined || rest.length === 0) return err("set <field> <value>, for example set quorum 4");
      const catalog = getCatalog();
      if (!catalog) return err("The catalog hasn't loaded yet.");
      const field = resolveField(doc.get().recipe, catalog, typed);
      if (!field.ok) return field;
      const ctx = studioState().analysis.context();
      const chainName = ctx.chain?.name;
      const checked = validateArg(field.value, argFromText(field.value, rest.join(" ")), {
        ...(ctx.chain ? { chain: ctx.chain } : {}),
        ...(chainName ? { chainName } : {}),
        ...(ctx.refs ? { refs: ctx.refs } : {}),
      });
      return checked.ok ? ok({ path: field.value.path, value: checked.value }) : checked;
    },
  },
  enabled(ctx, args) {
    const blocked = guard(ctx);
    if (blocked) return blocked;
    if (!isString(args.path)) return disabled("Name an init field");
    if (args.value === undefined) return disabled("Give the field a value");
    return OK;
  },
  run: lazyRun("setArg"),
});

export const addStepCommand = command<AddStepArgs>({
  id: "init.addStep",
  // INIT-04's button (spec L330).
  title: () => "Add init step",
  category: "Build",
  enabled(ctx, args) {
    const blocked = guard(ctx);
    if (blocked) return blocked;
    if (!isString(args.spec)) return disabled("Name the init to add");
    return OK;
  },
  run: lazyRun("addStep"),
});

/** A bundle by what it sets up: GovernedVaultInit → "GovernedVault". */
export function bundleName(spec: string): string {
  return spec.endsWith("Init") && spec.length > "Init".length ? spec.slice(0, -"Init".length) : spec;
}

export const useBundleCommand = command<UseBundleArgs>({
  id: "init.useBundle",
  // INIT-04's fix for a facet whose only inits are bundles: "Use the GovernedVault bundle" (Q28, 2026-10-06).
  title: ({ spec }) => `Use the ${bundleName(spec)} bundle`,
  category: "Build",
  enabled(ctx, args) {
    const blocked = guard(ctx);
    if (blocked) return blocked;
    if (!isString(args.spec)) return disabled("Name the bundle to use");
    return OK;
  },
  run: lazyRun("applyBundle"),
});

export const removeStepCommand = command<RemoveStepArgs>({
  id: "init.removeStep",
  // INIT-03's Remove {A}: the sides are init steps (spec L329).
  title: ({ path }) => `Remove ${specAt(doc.get().recipe, path) ?? "step"}`,
  category: "Build",
  enabled(ctx, args) {
    const blocked = guard(ctx);
    if (blocked) return blocked;
    if (!isString(args.path)) return disabled("Name the step to remove");
    return OK;
  },
  run: lazyRun("removeStep"),
});

export const moveStepCommand = command<MoveStepArgs>({
  id: "init.moveStep",
  title: () => "Move step",
  category: "Build",
  enabled(ctx, args) {
    const blocked = guard(ctx);
    if (blocked) return blocked;
    if (!isString(args.path) || stepIndex(args.path) === null) return disabled("Name the step to move");
    if (typeof args.to !== "number" || !Number.isSafeInteger(args.to)) return disabled("Say where to move it");
    return OK;
  },
  run: lazyRun("moveStep"),
});

export const reorderAutoCommand = command({
  id: "init.reorderAuto",
  // INIT-02's fix (spec L328).
  title: () => "Reorder steps automatically",
  category: "Build",
  palette: true,
  enabled(ctx) {
    const blocked = guard(ctx);
    if (blocked) return blocked;
    const init = ctx.project.recipe.init;
    if (init.kind === "bundle") return disabled(`${init.spec} is a bundle: its order is fixed`);
    if (init.kind !== "steps" || init.steps.length < 2) return disabled("The init plan has fewer than two steps");
    return OK;
  },
  run: lazyRun("reorderAuto"),
});
