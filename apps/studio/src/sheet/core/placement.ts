/**
 * Which cards were just placed, from two document states: a drop, a palette place, a recipe loaded in place and
 * an undo that brings a card back all add facets to the recipe of the same project. Their traces flash into the
 * core for a moment (`FLASH_MS`). Opening another project, or a load that replaces the document, places nothing.
 * Pure.
 */
import type { Project } from "@lattice-studio/core";
import { isCoreFacet } from "@lattice-studio/core";
import type { DocumentChange } from "@/contracts";

/** How long a just-placed card's trace shows in the accent, in ms. */
export const FLASH_MS = 1600;

/** The non-core facets on the sheet after the change that weren't in the recipe before it. */
export function placedBetween(before: Project, after: Project, change: DocumentChange["kind"] | undefined): string[] {
  if (change === "load" || before.id !== after.id || before.recipe.facets === after.recipe.facets) return [];
  const had = new Set(before.recipe.facets);
  return after.recipe.facets.filter((name) => !had.has(name) && !isCoreFacet(name) && after.layout[name] !== undefined);
}
