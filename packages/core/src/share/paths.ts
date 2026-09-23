import type { Catalog, InitParam } from "../model/catalog";
import type { Arg, Recipe } from "../model/recipe";
import { formatPath } from "../model/schema";

/** One literal init argument: a string or boolean, at its argument path ("bundle.p.asset", "steps[2].admin"). */
export type ArgLeaf = {
  path: string;
  value: string | boolean;
  /** The parameter (or tuple component, or array element) it fills; absent when the catalog doesn't say. */
  param?: InitParam;
};

type ArgObject = { [field: string]: Arg };

function isRef(value: ArgObject): boolean {
  return typeof value["$ref"] === "string";
}

function isArrayType(type: string): boolean {
  return /\[\d*\]$/.test(type);
}

/** An array parameter's element: the same parameter with one `[]` or `[n]` taken off its type. */
function elementOf(param: InitParam): InitParam {
  return { ...param, type: param.type.replace(/\[\d*\]$/, "") };
}

function walk(value: Arg, at: readonly (string | number)[], param: InitParam | undefined, out: ArgLeaf[]): void {
  if (typeof value === "string" || typeof value === "boolean") {
    out.push(param === undefined ? { path: formatPath(at), value } : { path: formatPath(at), value, param });
    return;
  }
  if (Array.isArray(value)) {
    // A list under a parameter that isn't an array (a tuple written positionally, or a malformed argument)
    // can't be matched to components, so its leaves get no parameter and every address in it counts.
    const element = param !== undefined && isArrayType(param.type) ? elementOf(param) : undefined;
    value.forEach((item, index) => walk(item, [...at, index], element, out));
    return;
  }
  if (isRef(value)) return;
  for (const [field, item] of Object.entries(value)) {
    walk(item, [...at, field], param?.components?.find((component) => component.name === field), out);
  }
}

/**
 * Every literal init argument in the recipe, in recipe order. References (`{ $ref }`) aren't literals: they
 * resolve to this diamond or the deploying account at build time, so they never came from outside.
 */
export function argLeaves(recipe: Recipe, catalog: Catalog | null): ArgLeaf[] {
  const out: ArgLeaf[] = [];
  const visit = (spec: string, args: Record<string, Arg>, root: readonly (string | number)[]): void => {
    const params = catalog?.inits.find((init) => init.name === spec)?.params;
    for (const [name, value] of Object.entries(args)) {
      walk(value, [...root, name], params?.find((param) => param.name === name), out);
    }
  };
  const { init } = recipe;
  if (init.kind === "bundle") visit(init.spec, init.args, ["bundle"]);
  if (init.kind === "steps") init.steps.forEach((step, index) => visit(step.spec, step.args, ["steps", index]));
  return out;
}

/** 20 bytes of hex in any letter case: without a catalog, C1 leaves argument strings as written. */
function looksLikeAddress(value: string | boolean): boolean {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
}

/**
 * Argument paths where an address that receives authority is a literal, so it came from the link or file
 * and must be confirmed before deploy (LINK-01, spec L334, L857). With the catalog, those are the parameters
 * it marks `authority`, plus any argument it has no parameter for. Without it (a catalog this build doesn't
 * bundle), Studio can't tell which parameters grant authority, so every address-shaped literal counts.
 */
export function unconfirmedPaths(recipe: Recipe, catalog: Catalog | null): string[] {
  return argLeaves(recipe, catalog)
    .filter((leaf) => looksLikeAddress(leaf.value) && (catalog === null || leaf.param === undefined || leaf.param.authority === true))
    .map((leaf) => leaf.path);
}

/**
 * `Project.provenance` for a recipe that came from a link or a file: every literal argument path marked with
 * its source (spec L241). S1 builds `AnalysisContext.unconfirmed` and `unconfirmedFrom` from it, and LINK-01
 * clears once the person confirms the address.
 */
export function argProvenance(recipe: Recipe, catalog: Catalog | null, source: "link" | "file"): Record<string, "link" | "file"> {
  return Object.fromEntries(argLeaves(recipe, catalog).map((leaf) => [leaf.path, source]));
}
