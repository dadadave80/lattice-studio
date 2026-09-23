/**
 * Template recipes ready to export: loaded through C5a's `loadTemplate`, with every argument the template
 * leaves for the person (GovernedVault's asset, SafeDiamondCut's Safe) filled by type, and a way to swap every
 * `string` argument for other text. Works on any catalog, so it doesn't pin the fixture's arguments.
 */
import type { Catalog, InitParam } from "../model/catalog";
import type { Address } from "../model/hex";
import type { Arg, Recipe } from "../model/recipe";
import { err, ok, type Result } from "../model/result";
import { loadTemplate, templateList } from "../plan";

/** Fills an address argument a template leaves empty; any nonzero literal passes the offline rules. */
export const FILL_ADDRESS: Address = "0x71C7656EC7ab88b098defB751B7401B5f6d8976F";

/** A value that passes every offline rule for the parameter's type (rules on the pinned catalog: nonzero, gte(1)). */
function fillFor(param: Pick<InitParam, "type" | "components" | "rule">): Arg {
  if (param.type.endsWith("]")) return [];
  if (param.type === "tuple") return fillTuple(param.components ?? [], {});
  if (param.type === "address") return FILL_ADDRESS;
  if (param.type === "bool") return false;
  if (/^u?int[0-9]*$/.test(param.type)) return "1";
  if (/^bytes[0-9]+$/.test(param.type)) return `0x${"01".repeat(Number(param.type.slice(5)))}`;
  if (param.type === "bytes") return "0x01";
  return "x";
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

function mapArg(value: Arg, param: Pick<InitParam, "type" | "components"> | undefined, path: string, f: (path: string, value: string) => string): Arg {
  if (param === undefined) return value;
  if (param.type === "string" && typeof value === "string") return f(path, value);
  if (param.type === "tuple" && isObject(value)) return mapFields(value, param.components ?? [], path, f);
  if (param.type.endsWith("]") && Array.isArray(value)) {
    const element: Pick<InitParam, "type" | "components"> = { type: param.type.replace(/\[[0-9]*\]$/, "") };
    if (param.components !== undefined) element.components = param.components;
    return value.map((item, i) => mapArg(item, element, `${path}[${i}]`, f));
  }
  return value;
}

function mapFields(args: { [field: string]: Arg }, params: readonly Pick<InitParam, "name" | "type" | "components">[], at: string, f: (path: string, value: string) => string): { [field: string]: Arg } {
  const out: { [field: string]: Arg } = {};
  for (const [field, value] of Object.entries(args)) {
    out[field] = mapArg(value, params.find((param) => param.name === field), at === "" ? field : `${at}.${field}`, f);
  }
  return out;
}

/**
 * `recipe` with every `string`-typed init argument (tuple components and array elements included) replaced by
 * `f(path, value)`. Paths read like C4a's: `bundle.p.name`, `steps[0].name_`.
 */
export function mapStringArgs(recipe: Recipe, catalog: Catalog, f: (path: string, value: string) => string): Recipe {
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

/** The paths of every `string`-typed init argument `recipe` holds. */
export function stringArgPaths(recipe: Recipe, catalog: Catalog): string[] {
  const paths: string[] = [];
  mapStringArgs(recipe, catalog, (path, value) => {
    paths.push(path);
    return value;
  });
  return paths;
}
