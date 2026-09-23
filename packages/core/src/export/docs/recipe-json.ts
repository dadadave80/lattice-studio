import { normalizeRecipe } from "../../canonical";
import type { ExportRecipeJsonFn } from "../../model/api";
import { RECIPE_SCHEMA_URL } from "./schema-url";

/**
 * `recipe.json` with `$schema` (spec L920-L923): normalized (canonical key order, facets in catalog order,
 * spec L293) and stamped with the hosted schema URL, whatever `$schema` the input recipe carried. Leaves out
 * layout, deploy settings and deployments (spec L516), which don't belong to `Recipe` in the first place.
 * 2-space indent, one trailing newline.
 */
export const exportRecipeJson: ExportRecipeJsonFn = (recipe, catalog) => {
  const normalized = normalizeRecipe({ ...recipe, $schema: RECIPE_SCHEMA_URL }, catalog);
  return { filename: "recipe.json", mime: "application/json", text: `${JSON.stringify(normalized, null, 2)}\n` };
};
