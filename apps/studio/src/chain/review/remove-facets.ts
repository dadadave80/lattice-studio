/**
 * Remove facets (NET-06, Flow 14 spec L595): which placed facets the diamond can't do without, and why, in the
 * checks' own words. A facet is required when removing it adds a blocker the recipe doesn't have now (CORE-01's
 * "The loupe is incomplete: …", DEP-01's "VaultCore requires ERC4626: …"). Pure: no React, no stores, no chain.
 */
import type { Catalog, Problem, Project } from "@lattice-studio/core";
import { analyze, removeFacets } from "@lattice-studio/core";

function blockerIds(problems: readonly Problem[]): Set<string> {
  return new Set(problems.filter((p) => p.severity === "blocker").map((p) => p.id));
}

/** The first blocker removing `names` adds, against the blockers in `baseline`; null when it adds none. */
function addedBlocker(project: Project, catalog: Catalog, names: readonly string[], baseline: ReadonlySet<string>): string | null {
  const result = removeFacets(project, catalog, names);
  if (!result.changed) return null;
  const after = analyze(result.project.recipe, catalog);
  const added = after.problems.find((p) => p.severity === "blocker" && !baseline.has(p.id));
  return added ? added.message : null;
}

/**
 * The facets among `names` that can't be removed on their own, each with the first blocker its removal adds
 * (the problem's message, as the checks word it). Facets whose removal adds nothing aren't in the map.
 */
export function requiredFacets(project: Project, catalog: Catalog, names: readonly string[]): Map<string, string> {
  const baseline = blockerIds(analyze(project.recipe, catalog).problems);
  const locked = new Map<string, string>();
  for (const name of names) {
    const reason = addedBlocker(project, catalog, [name], baseline);
    if (reason !== null) locked.set(name, reason);
  }
  return locked;
}

/** The first blocker removing all of `names` together adds, or null when the combination adds none. */
export function removalBlocker(project: Project, catalog: Catalog, names: readonly string[]): string | null {
  if (names.length === 0) return null;
  return addedBlocker(project, catalog, names, blockerIds(analyze(project.recipe, catalog).problems));
}
