/** Lookups the planner and the INIT checks share. Inits resolve by `name` (contracts §3.1, K3's CCR). */
import type { Catalog, InitSpec } from "../../model/catalog";
import type { FieldModel } from "../../model/init";
import type { Arg } from "../../model/recipe";

/** The init spec named `name`, if the catalog has it. */
export function findSpec(catalog: Catalog, name: string): InitSpec | undefined {
  return catalog.inits.find((spec) => spec.name === name);
}

/** Every module the spec initializes, directly or through its libraries. */
export function modulesOf(spec: InitSpec | undefined): Set<string> {
  return new Set(spec?.initializes.map((entry) => entry.module) ?? []);
}

/**
 * The module an init is for: the last one it initializes (VaultCoreInit → VaultCore, ERC20PermitInit →
 * ERC20Permit), or its contract name without "Init" when it initializes none.
 */
export function mainModule(spec: InitSpec): string {
  return spec.initializes.at(-1)?.module ?? spec.contract.replace(/Init$/, "");
}

/**
 * The module a facet's own init is for: the `initializes` entry named after the facet, when there is one,
 * else `mainModule` (INIT-04, WP-FX23). ERC20VotesInit ends with AccessControl even though ERC20Votes is
 * its own module, so INIT-04 asks for this rather than assuming the last module is the facet's.
 */
export function facetModule(facet: string, spec: InitSpec): string {
  return spec.initializes.some((entry) => entry.module === facet) ? facet : mainModule(spec);
}

/** True when an upgrade mechanism (a facet of the "upgrade" family) is placed (R11). */
export function hasUpgradeMechanism(facets: readonly string[], catalog: Catalog): boolean {
  const placed = new Set(facets);
  return catalog.facets.some((facet) => facet.family === "upgrade" && placed.has(facet.name));
}

/** The value at a dotted component path under a step's args: `["p", "asset"]` reads `args.p.asset`. */
export function argAt(args: Record<string, Arg>, parts: readonly string[]): Arg | undefined {
  let current: Arg | undefined = args;
  for (const part of parts) {
    if (typeof current !== "object" || current === null || Array.isArray(current) || !Object.hasOwn(current, part)) return undefined;
    current = (current as Record<string, Arg>)[part];
  }
  return current;
}

/** One field with the argument that fills it; tuples are walked into their components. */
export type Leaf = { field: FieldModel; value: Arg | undefined };

/** The fields a form shows one control for, each with its argument, in parameter and component order. */
export function leaves(fields: readonly FieldModel[], args: Record<string, Arg> | undefined): Leaf[] {
  return fields.flatMap((field) => {
    const value = args !== undefined && Object.hasOwn(args, field.name) ? args[field.name] : undefined;
    if (field.kind === "tuple" && field.components) {
      const record = typeof value === "object" && value !== null && !Array.isArray(value) && !("$ref" in value) ? (value as Record<string, Arg>) : undefined;
      return leaves(field.components, record);
    }
    return [{ field, value }];
  });
}
