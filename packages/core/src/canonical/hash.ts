import type { CatalogHashFn, RecipeHashFn } from "../model/api";
import { notImplemented } from "../model/wp";

export const recipeHash: RecipeHashFn = () => notImplemented("C1", "recipeHash");
export const catalogHash: CatalogHashFn = () => notImplemented("C1", "catalogHash");
