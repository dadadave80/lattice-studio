import type { NormalizeRecipeFn } from "../model/api";
import type { Catalog, InitParam } from "../model/catalog";
import { isHexAnyCase, toChecksum, toLowerHex, type Hex4 } from "../model/hex";
import type { Arg, InitStep, Recipe, RecipeInit } from "../model/recipe";

/** What argument normalization needs to know about a parameter: its ABI type and, for tuples, components. */
type ParamShape = Pick<InitParam, "type" | "components">;

const ADDRESS_SHAPE = /^0x[0-9a-fA-F]{40}$/;
const DECIMAL = /^-?[0-9]+$/;
const HEX_INTEGER = /^0x[0-9a-fA-F]+$/;
const INTEGER_TYPE = /^u?int[0-9]*$/;
const BYTES_TYPE = /^bytes[0-9]*$/;
const ARRAY_SUFFIX = /\[[0-9]*\]$/;

function isArgObject(value: Arg): value is { [field: string]: Arg } {
  return typeof value === "object" && !Array.isArray(value);
}

function isRef(value: Arg): value is { $ref: "self" | "deployer" } {
  return isArgObject(value) && Object.hasOwn(value, "$ref");
}

/**
 * EIP-55 for an address written in one case (all lowercase or all uppercase). A mixed-case address is either
 * already its checksum or a mistyped one; either way it stays as written, so INIT-01's checksum validation
 * (spec L462) still sees the mistake.
 */
function checksum(value: string): string {
  const digits = value.slice(2);
  if (digits !== digits.toLowerCase() && digits !== digits.toUpperCase()) return value;
  return toChecksum(`0x${digits.toLowerCase()}`);
}

/**
 * An argument whose parameter type isn't known (its init or parameter isn't in the catalog, or the catalog
 * isn't bundled): structure only. Strings stay exactly as written, because without the type Studio can't
 * tell an address or bytes from text, and the hash must not depend on which catalogs a build bundles.
 */
function normalizeUntyped(value: Arg): Arg {
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(normalizeUntyped);
  if (isRef(value)) return { $ref: value.$ref };
  return mapFields(value, () => undefined);
}

/** Integers as decimal strings (spec L283): leading zeros dropped, `-0` is `0`, hex integers in decimal. */
function normalizeInteger(value: string): string {
  if (DECIMAL.test(value) || HEX_INTEGER.test(value)) return BigInt(value).toString();
  return value;
}

/**
 * An argument by its ABI type. Text (`string`) is never touched, so a token named "0xABC" keeps its case;
 * a value that doesn't fit its type is left for C4a's validation (INIT-01) and normalized as untyped.
 */
function normalizeArg(value: Arg, param: ParamShape | undefined): Arg {
  if (param === undefined) return normalizeUntyped(value);
  if (isRef(value)) return { $ref: value.$ref };
  const { type } = param;
  if (ARRAY_SUFFIX.test(type)) {
    if (!Array.isArray(value)) return normalizeUntyped(value);
    const element: ParamShape = { type: type.replace(ARRAY_SUFFIX, "") };
    if (param.components) element.components = param.components;
    return value.map((item) => normalizeArg(item, element));
  }
  if (type === "tuple") {
    if (!isArgObject(value)) return normalizeUntyped(value);
    const components = param.components ?? [];
    return mapFields(value, (field) => components.find((c) => c.name === field));
  }
  if (typeof value !== "string") return normalizeUntyped(value);
  if (type === "address") return ADDRESS_SHAPE.test(value) ? checksum(value) : value;
  if (INTEGER_TYPE.test(type)) return normalizeInteger(value);
  if (BYTES_TYPE.test(type)) return isHexAnyCase(value) ? toLowerHex(value) : value;
  return value;
}

/** Each field of an argument object (or of `args`), by the parameter `paramOf` finds for it. */
function mapFields(value: { [field: string]: Arg }, paramOf: (field: string) => ParamShape | undefined): { [field: string]: Arg } {
  const out: { [field: string]: Arg } = {};
  for (const field of Object.keys(value)) {
    const arg = value[field];
    if (arg !== undefined) out[field] = normalizeArg(arg, paramOf(field));
  }
  return out;
}

function normalizeArgs(args: Record<string, Arg>, spec: string, catalog: Catalog | null): Record<string, Arg> {
  const params = catalog?.inits.find((init) => init.name === spec)?.params;
  if (params === undefined) return mapFields(args, () => undefined);
  return mapFields(args, (field) => params.find((param) => param.name === field));
}

/** Known keys first in `order`, then every other key of `source` in its own order (unknown fields survive). */
function withRest<T extends object>(known: Partial<T>, source: T, order: readonly (keyof T & string)[]): T {
  const out: Record<string, unknown> = {};
  for (const key of order) if (known[key] !== undefined) out[key] = known[key];
  for (const key of Object.keys(source)) if (!(order as readonly string[]).includes(key)) out[key] = (source as Record<string, unknown>)[key];
  return out as T;
}

function normalizeInit(init: RecipeInit, catalog: Catalog | null): RecipeInit {
  switch (init.kind) {
    case "bundle":
      return withRest({ kind: init.kind, spec: init.spec, args: normalizeArgs(init.args, init.spec, catalog) }, init, ["kind", "spec", "args"]);
    case "steps":
      return withRest(
        {
          kind: init.kind,
          steps: init.steps.map((step) =>
            withRest<InitStep>({ spec: step.spec, args: normalizeArgs(step.args, step.spec, catalog) }, step, ["spec", "args"]),
          ),
        },
        init,
        ["kind", "steps"],
      );
    default:
      return withRest({ kind: init.kind }, init, ["kind"]);
  }
}

/** Deduplicated; catalog order, then names the catalog lacks in their input order. Without a catalog, input order. */
function orderFacets(facets: readonly string[], catalog: Catalog | null): string[] {
  const unique = [...new Set(facets)];
  if (catalog === null) return unique;
  const index = new Map(catalog.facets.map((facet, at) => [facet.name, at]));
  const known = unique.filter((name) => index.has(name)).sort((a, b) => (index.get(a) ?? 0) - (index.get(b) ?? 0));
  return [...known, ...unique.filter((name) => !index.has(name))];
}

/**
 * Keys lowercase, emitted in sorted order. Two keys that differ only in case resolve deterministically:
 * keys are applied in code-unit order, so the lowercase spelling (which sorts last) wins. Parsing refuses
 * case variants that name different facets (`ownerCaseConflicts`), so only same-facet duplicates get here.
 */
function normalizeOwners(owners: Record<Hex4, string>): Record<Hex4, string> {
  const byKey = new Map<Hex4, string>();
  for (const key of Object.keys(owners).sort()) {
    const owner = owners[key as Hex4];
    if (owner !== undefined) byKey.set(key.toLowerCase() as Hex4, owner);
  }
  const out: Record<Hex4, string> = {};
  for (const key of [...byKey.keys()].sort()) out[key] = byKey.get(key) ?? "";
  return out;
}

function normalizeExclude(exclude: readonly Hex4[]): Hex4[] {
  return [...new Set(exclude.map(toLowerHex))].sort();
}

const RECIPE_ORDER = [
  "$schema", "schemaVersion", "name", "catalog", "template", "facets", "owners", "exclude", "init", "immutable",
] as const;

/**
 * `normalizeRecipe` with the catalog optional: without one (a recipe pinned to a catalog this build doesn't
 * bundle, spec L290), facets keep their input order and argument strings stay as written.
 */
export function normalizeWith(recipe: Recipe, catalog: Catalog | null): Recipe {
  const known: Partial<Recipe> = {
    schemaVersion: recipe.schemaVersion,
    catalog: withRest({ tag: recipe.catalog.tag, hash: toLowerHex(recipe.catalog.hash) }, recipe.catalog, ["tag", "hash"]),
    facets: orderFacets(recipe.facets, catalog),
    owners: normalizeOwners(recipe.owners),
    exclude: normalizeExclude(recipe.exclude),
    init: normalizeInit(recipe.init, catalog),
  };
  if (recipe.$schema !== undefined) known.$schema = recipe.$schema;
  if (recipe.name !== undefined) known.name = recipe.name;
  if (recipe.template !== undefined) {
    known.template = withRest(
      { name: recipe.template.name, catalogHash: toLowerHex(recipe.template.catalogHash) },
      recipe.template,
      ["name", "catalogHash"],
    );
  }
  if (recipe.immutable === true) known.immutable = true;
  return withRest(known, recipe, RECIPE_ORDER);
}

/**
 * The recipe as it is hashed and stored (spec L283): facets deduplicated into catalog order, `owners` keys
 * lowercase in sorted order, `exclude` lowercase, sorted and deduplicated, catalog and template hashes
 * lowercase, and init arguments by their parameter types (integers as decimal strings, `bytes` lowercase,
 * addresses written in one case EIP-55; text untouched). An argument whose type the catalog doesn't give
 * keeps its strings as written. References stay `{"$ref": …}`. Unknown fields are kept. Idempotent.
 * Facets the catalog lacks follow the known ones in input order (parsing refuses them).
 */
export const normalizeRecipe: NormalizeRecipeFn = (recipe, catalog) => normalizeWith(recipe, catalog);
