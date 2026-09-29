/**
 * What recipe.json can't say about itself (spec L509, L515; ruling R6). Every export is headed with the recipe
 * hash, the catalog tag and the Studio version and states what it leaves out, but the JSON body stays exactly
 * what core writes: an extra field would come back as "Studio kept N fields". So the Recipe JSON tab and the
 * console line for a saved recipe.json carry them instead.
 */
import type { ExportFile, Hex } from "@lattice-studio/core";
import { shortHash } from "@/app/format";
import { STUDIO_VERSION } from "@/app/version";

/** Spec L515's words. */
export const RECIPE_JSON_LEAVES_OUT = "Leaves out layout, deploy settings and deployments";

/** The filename core's `exportRecipeJson` gives every recipe.json. */
export const RECIPE_JSON_FILENAME = "recipe.json";

export function isRecipeJson(file: Pick<ExportFile, "filename">): boolean {
  return file.filename === RECIPE_JSON_FILENAME;
}

/** "catalog Lattice v0.4.0 · Studio 0.1.0 · Leaves out layout, deploy settings and deployments" */
export function recipeJsonNotes(catalogTag: string, studioVersion: string = STUDIO_VERSION): string {
  return `catalog Lattice ${catalogTag} · Studio ${studioVersion} · ${RECIPE_JSON_LEAVES_OUT}`;
}

/** The Recipe JSON tab's line: "Recipe 0x3f2a…a1c4 · catalog Lattice v0.4.0 · Studio 0.1.0 · Leaves out …". */
export function recipeJsonHeader(recipeHash: Hex, catalogTag: string, studioVersion: string = STUDIO_VERSION): string {
  return `Recipe ${shortHash(recipeHash)} · ${recipeJsonNotes(catalogTag, studioVersion)}`;
}
