import type { ProjectStatusFn, RecipeStatsFn } from "../model/api";
import { notImplemented } from "../model/wp";

export const projectStatus: ProjectStatusFn = () => notImplemented("C5a", "projectStatus");
export const recipeStats: RecipeStatsFn = () => notImplemented("C5a", "recipeStats");
