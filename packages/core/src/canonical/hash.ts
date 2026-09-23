import { keccak256, stringToBytes } from "viem";
import type { CatalogHashFn, RecipeHashFn } from "../model/api";
import type { Hex } from "../model/hex";
import type { Recipe, RecipeInit } from "../model/recipe";
import { canonicalJson } from "./json";
import { normalizeRecipe } from "./normalize";

function keccakOf(value: unknown): Hex {
  return keccak256(stringToBytes(canonicalJson(value)));
}

function hashedInit(init: RecipeInit): RecipeInit {
  switch (init.kind) {
    case "bundle":
      return { kind: "bundle", spec: init.spec, args: init.args };
    case "steps":
      return { kind: "steps", steps: init.steps.map((step) => ({ spec: step.spec, args: step.args })) };
    default:
      return { kind: "none" };
  }
}

/**
 * What the hash covers: the recipe's known fields minus `$schema`, `name` and `template`, rebuilt from an
 * allowlist so unknown fields at any level (`extra`, `catalog.note`, `init.steps[0].x`) never reach it.
 * Arguments are open objects and go in whole.
 */
export function hashedRecipe(recipe: Recipe): Omit<Recipe, "$schema" | "name" | "template"> {
  const shape: Omit<Recipe, "$schema" | "name" | "template"> = {
    schemaVersion: recipe.schemaVersion,
    catalog: { tag: recipe.catalog.tag, hash: recipe.catalog.hash },
    facets: recipe.facets,
    owners: recipe.owners,
    exclude: recipe.exclude,
    init: hashedInit(recipe.init),
  };
  if (recipe.immutable === true) shape.immutable = true;
  return shape;
}

/**
 * keccak256 of the RFC 8785 canonical JSON (UTF-8) of the recipe without `$schema`, `name`, `template` and
 * unknown fields (spec L283). With `catalog` it normalizes first; without it, `recipe` must already be
 * `normalizeRecipe`'s output.
 */
export const recipeHash: RecipeHashFn = (recipe, catalog) =>
  keccakOf(hashedRecipe(catalog === undefined ? recipe : normalizeRecipe(recipe, catalog)));

/** keccak256 of the canonical catalog index without its top-level `hash` field. */
export const catalogHash: CatalogHashFn = (index) => {
  const rest: Record<string, unknown> = { ...index };
  delete rest["hash"];
  return keccakOf(rest);
};
