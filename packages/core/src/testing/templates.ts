/**
 * Template recipes ready to export: loaded through C5a's `loadTemplate`, with every argument the template
 * leaves for the person (GovernedVault's asset, SafeDiamondCut's Safe) filled by type, and a way to swap every
 * `string` argument for other text. Works on any catalog, so it doesn't pin the fixture's arguments.
 */
import type { Catalog, InitParam } from "../model/catalog";
import type { Address } from "../model/hex";
import type { Arg, Recipe } from "../model/recipe";
import { err, ok, type Result } from "../model/result";
import { analyze } from "../analysis";
import { loadTemplate, templateList } from "../plan";

/** Fills an address argument a template leaves empty; any nonzero literal passes the offline rules. */
export const FILL_ADDRESS: Address = "0x71C7656EC7ab88b098defB751B7401B5f6d8976F";

/**
 * What a `rule` (contracts §4 grammar: `range(a,b)`, `gt(n)`, `gte(n)`, `nonzero`, `maxlen(n)`,
 * `code(safe|token|contract)`, `enum(a|b|c)`, joined with `&`) allows offline. `code(…)` is a chain rule, checked
 * only with a chain, so it constrains nothing here. Malformed terms are ignored, as C4a ignores them.
 */
export type OfflineRule = { min?: bigint; max?: bigint; nonzero?: true; maxlen?: number; options?: string[] };

const RULE_TERM = /^([a-z]+)(?:\((.*)\))?$/;

function bigintOf(text: string | undefined): bigint | undefined {
  const trimmed = text?.trim() ?? "";
  return /^-?[0-9]+$/.test(trimmed) ? BigInt(trimmed) : undefined;
}

/** Parses a rule into the bounds it sets; every bound of the same kind tightens the last. */
export function offlineRule(rule: string | undefined): OfflineRule {
  const out: OfflineRule = {};
  const atLeast = (n: bigint): void => {
    if (out.min === undefined || n > out.min) out.min = n;
  };
  const atMost = (n: bigint): void => {
    if (out.max === undefined || n < out.max) out.max = n;
  };
  for (const raw of (rule ?? "").split("&")) {
    const match = RULE_TERM.exec(raw.trim());
    if (match === null) continue;
    const [, name, arg] = match;
    if (name === "range") {
      const [a, b] = (arg ?? "").split(",").map(bigintOf);
      if (a !== undefined && b !== undefined) {
        atLeast(a);
        atMost(b);
      }
    } else if (name === "gt" || name === "gte") {
      const n = bigintOf(arg);
      if (n !== undefined) atLeast(name === "gt" ? n + 1n : n);
    } else if (name === "nonzero") {
      out.nonzero = true;
    } else if (name === "maxlen") {
      const n = bigintOf(arg);
      if (n !== undefined && n >= 0n) out.maxlen = out.maxlen === undefined ? Number(n) : Math.min(out.maxlen, Number(n));
    } else if (name === "enum") {
      const options = (arg ?? "").split("|").map((o) => o.trim()).filter((o) => o !== "");
      if (options.length > 0) out.options = options;
    }
  }
  return out;
}

/** An integer the rule allows: 1 when it can be, else the nearest bound (never 0 under `nonzero`). */
function integerFor(rule: OfflineRule, signed: boolean): string {
  const first = rule.options?.find((option) => /^-?[0-9]+$/.test(option));
  if (first !== undefined) return BigInt(first).toString();
  let value = 1n;
  if (rule.min !== undefined && value < rule.min) value = rule.min;
  if (rule.max !== undefined && value > rule.max) value = rule.max;
  if (!signed && value < 0n) value = 0n;
  if (rule.nonzero === true && value === 0n) value = 1n;
  return value.toString();
}

/** `text` made to fit the rule: the first `enum` option, or at most `maxlen` characters (whole code points). */
export function fitText(text: string, rule: string | undefined): string {
  const parsed = offlineRule(rule);
  if (parsed.options !== undefined) return parsed.options[0] ?? text;
  if (parsed.maxlen === undefined) return text;
  return Array.from(text).slice(0, parsed.maxlen).join("");
}

/** A value that passes every offline rule of the parameter, by its type (chain rules such as `code(safe)` aside). */
export function fillFor(param: Pick<InitParam, "type" | "components" | "rule">): Arg {
  const rule = offlineRule(param.rule);
  if (param.type.endsWith("]")) return [];
  if (param.type === "tuple") return fillTuple(param.components ?? [], {});
  if (param.type === "address") return rule.options?.[0] ?? FILL_ADDRESS;
  if (param.type === "bool") return false;
  const integer = /^(u?)int[0-9]*$/.exec(param.type);
  if (integer !== null) return integerFor(rule, integer[1] === "");
  if (/^bytes[0-9]+$/.test(param.type)) return rule.options?.[0] ?? `0x${"01".repeat(Number(param.type.slice(5)))}`;
  if (param.type === "bytes") return rule.options?.[0] ?? "0x01";
  return fitText("x", param.rule);
}

function isObject(value: Arg | undefined): value is { [field: string]: Arg } {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !Object.hasOwn(value, "$ref");
}

function fillTuple(params: readonly InitParam[], args: { [field: string]: Arg }): { [field: string]: Arg } {
  const out: { [field: string]: Arg } = { ...args };
  for (const param of params) {
    const value = out[param.name];
    if (value === undefined) out[param.name] = fillFor(param);
    else if (param.type === "tuple" && isObject(value)) out[param.name] = fillTuple(param.components ?? [], value);
  }
  return out;
}

/** `recipe` with every missing init argument filled by its type. */
export function fillMissingArgs(recipe: Recipe, catalog: Catalog): Recipe {
  const paramsOf = (spec: string): InitParam[] => catalog.inits.find((init) => init.name === spec)?.params ?? [];
  const { init } = recipe;
  if (init.kind === "bundle") return { ...recipe, init: { ...init, args: fillTuple(paramsOf(init.spec), init.args) } };
  if (init.kind === "steps") {
    return { ...recipe, init: { ...init, steps: init.steps.map((step) => ({ ...step, args: fillTuple(paramsOf(step.spec), step.args) })) } };
  }
  return recipe;
}

/** The loadable (v1, plain Lattice proxy) templates' names, in catalog order. */
export function loadableTemplates(catalog: Catalog): string[] {
  return templateList(catalog)
    .filter((item) => item.loadable)
    .map((item) => item.name);
}

/** Template `name`, loaded and with every argument it leaves empty filled. */
export function filledTemplate(catalog: Catalog, name: string): Result<Recipe, string> {
  const loaded = loadTemplate(catalog, name);
  return loaded.ok ? ok(fillMissingArgs(loaded.value, catalog)) : err(loaded.error);
}

/**
 * The loadable templates that export as they are once filled: no blocker in their analysis offline. A catalog
 * whose templates need a chain (or a person) to clear a blocker contributes fewer; one with none gives [].
 */
export function exportableTemplates(catalog: Catalog): Recipe[] {
  return loadableTemplates(catalog).flatMap((name) => {
    const filled = filledTemplate(catalog, name);
    if (!filled.ok) return [];
    const blocked = analyze(filled.value, catalog, { known: [], unconfirmed: [] }).problems.some((p) => p.severity === "blocker");
    return blocked ? [] : [filled.value];
  });
}

/** The parameter shape a leaf mapper sees: its ABI type and its rule (for `maxlen` or `enum`). */
export type StringArgParam = Pick<InitParam, "type" | "components" | "rule">;

/** Replaces one `string` argument: its path, its current value and its parameter. */
export type StringArgMapper = (path: string, value: string, param: StringArgParam) => string;

/**
 * Replaces one argument site: its path, its current value and its parameter shape. Runs on every scalar leaf
 * (`string`, `address`, `bool`, an integer or `bytes` type) and, after their elements or components are
 * mapped, on a tuple or an array itself, so a mapper can also replace a whole object or list. Returning the
 * value unchanged leaves it; `Arg`'s shape isn't checked against `param.type`, so a mapper may deliberately
 * replace a scalar's value with an object (model/schema.ts's `ArgSchema` allows any object shape but the
 * literal `"$ref"` key — a hostile file or share link can do the same).
 */
export type ArgMapper = (path: string, value: Arg, param: StringArgParam) => Arg;

function mapArg(value: Arg, param: StringArgParam | undefined, path: string, f: ArgMapper): Arg {
  if (param === undefined) return value;
  if (param.type === "tuple" && isObject(value)) return f(path, mapFields(value, param.components ?? [], path, f), param);
  if (param.type.endsWith("]") && Array.isArray(value)) {
    const element: StringArgParam = { type: param.type.replace(/\[[0-9]*\]$/, "") };
    if (param.components !== undefined) element.components = param.components;
    if (param.rule !== undefined) element.rule = param.rule;
    const mapped = value.map((item, i) => mapArg(item, element, `${path}[${i}]`, f));
    return f(path, mapped, param);
  }
  return f(path, value, param);
}

function mapFields(args: { [field: string]: Arg }, params: readonly Pick<InitParam, "name" | "type" | "components" | "rule">[], at: string, f: ArgMapper): { [field: string]: Arg } {
  const out: { [field: string]: Arg } = {};
  for (const [field, value] of Object.entries(args)) {
    out[field] = mapArg(value, params.find((param) => param.name === field), at === "" ? field : `${at}.${field}`, f);
  }
  return out;
}

/**
 * `recipe` with every init argument site (scalar leaves, then tuples and arrays once their contents are
 * mapped) replaced by `f(path, value, param)`. Paths read like C4a's: `bundle.p.name`, `steps[0].name_`.
 */
export function mapArgs(recipe: Recipe, catalog: Catalog, f: ArgMapper): Recipe {
  const paramsOf = (spec: string): InitParam[] => catalog.inits.find((init) => init.name === spec)?.params ?? [];
  const { init } = recipe;
  if (init.kind === "bundle") return { ...recipe, init: { ...init, args: mapFields(init.args, paramsOf(init.spec), "bundle", f) } };
  if (init.kind === "steps") {
    return {
      ...recipe,
      init: { ...init, steps: init.steps.map((step, i) => ({ ...step, args: mapFields(step.args, paramsOf(step.spec), `steps[${i}]`, f) })) },
    };
  }
  return recipe;
}

/**
 * `recipe` with every `string`-typed init argument (tuple components and array elements included) replaced by
 * `f(path, value, param)`; every other site is left as `mapArgs` found it.
 */
export function mapStringArgs(recipe: Recipe, catalog: Catalog, f: StringArgMapper): Recipe {
  return mapArgs(recipe, catalog, (path, value, param) => (param.type === "string" && typeof value === "string" ? f(path, value, param) : value));
}

/** The paths of every `string`-typed init argument `recipe` holds. */
export function stringArgPaths(recipe: Recipe, catalog: Catalog): string[] {
  const paths: string[] = [];
  mapStringArgs(recipe, catalog, (path, value) => {
    paths.push(path);
    return value;
  });
  return paths;
}

/** The paths of every scalar-typed init argument leaf `recipe` holds: not a tuple and not an array. */
export function scalarArgPaths(recipe: Recipe, catalog: Catalog): string[] {
  const paths: string[] = [];
  mapArgs(recipe, catalog, (path, value, param) => {
    if (param.type !== "tuple" && !param.type.endsWith("]")) paths.push(path);
    return value;
  });
  return paths;
}

/**
 * `recipe` with the scalar leaf at `path` (from `scalarArgPaths`) replaced by `{ [key]: value }`: the field's
 * original value, now the sole entry of a hostile-keyed object. Exercises the gap `describeArg` documents
 * (export/docs/brief.ts): a scalar-typed field's declared ABI type isn't checked against its stored value
 * until it's encoded, so a hostile file or share link can put an object there, and its field key renders as
 * prose. `{ [key]: value }` (never `out[key] = value`) so a key like `"__proto__"` sets a property instead of
 * silently vanishing into the object's prototype. `recipe` unchanged if `path` isn't a scalar leaf it has.
 */
export function keyedArg(recipe: Recipe, catalog: Catalog, path: string, key: string): Recipe {
  return mapArgs(recipe, catalog, (at, value, param) =>
    at === path && param.type !== "tuple" && !param.type.endsWith("]") ? { [key]: value } : value,
  );
}
