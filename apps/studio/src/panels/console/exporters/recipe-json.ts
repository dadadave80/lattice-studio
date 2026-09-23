/** The recipe.json exporter's lazy chunk (spec L515, L822): C7b's `exportRecipeJson`, byte for byte. */
import type { Catalog, ExportFile, Recipe } from "@lattice-studio/core";
import { exportRecipeJson } from "@lattice-studio/core";

export function recipeJson(input: { recipe: Recipe; catalog: Catalog }): ExportFile {
  return exportRecipeJson(input.recipe, input.catalog);
}
