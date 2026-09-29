/**
 * The seed Flow 7's reorder cases need (WP-FX50): a diamond whose init plan is a step plan with two movable steps.
 *
 * Q1c found no v1 *template* that gives one (ERC20's only movable step is ERC20Init itself), but the Blank diamond
 * is not a template: it already ships AccessControlInit as its one step, and Add init step (`addInitStep`, what the
 * facet's Init section and `init.addStep` run) puts ERC20Init beside it. The plan then reads
 *
 *   01 AccessControlInit · 02 ERC20Init · 03 Register ERC-165 interfaces (automatic, locked)
 *
 * with two movable steps and no `after` constraint between them, so either order is valid: a move never raises
 * INIT-02. Built in Node with core against the real catalog, like every seed in `_support/projects.ts`.
 */
import { addInitStep, placeFacet, type Project } from "@lattice-studio/core";
import { fillMissingArgs } from "@lattice-studio/core/testing";
import { catalog } from "../_support/catalog.ts";
import { projectFor, recipeProject } from "../_support/projects.ts";

/** The steps in the seed's plan, in call order, before any move. */
export const SEEDED_STEPS = ["AccessControlInit", "ERC20Init"] as const;

/** The Blank diamond with ERC20 placed and ERC20Init added as a second movable init step, every argument filled. */
export function twoStepProject(): Project {
  const from = catalog();
  const placed = placeFacet(recipeProject("Blank diamond"), from, "ERC20", { x: 0, y: 0 });
  const added = addInitStep(placed.project, from, "ERC20Init");
  if (!added.changed) throw new Error(`Couldn't add ERC20Init to the Blank diamond: ${added.summary}`);
  return projectFor(fillMissingArgs(added.project.recipe, from), "Two init steps", { id: "e2e-two-init-steps" }, from);
}
