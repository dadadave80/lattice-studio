import type { Catalog } from "../model/catalog";
import type { Recipe } from "../model/recipe";
import { err, type Result } from "../model/result";
import { validateRecipe } from "../model/schema";
import { projectUpgradeCatalog, type UpgradeResolution } from "./projection";

export type { UpgradeRawFacet, UpgradeResolution } from "./projection";

/** Full validation stays at planning boundaries; eager metadata projections do not load the schema engine. */
export function resolveUpgrade(recipe: Recipe, catalog: Catalog): Result<UpgradeResolution, string> {
  const valid = validateRecipe(recipe);
  return valid.ok ? projectUpgradeCatalog(recipe, catalog) : err("The upgrade recipe has invalid facet descriptors.");
}
