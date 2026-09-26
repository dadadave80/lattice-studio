/**
 * Owner choices that settle several selectors at once, as one undo step: a collision note's Keep {A} and
 * Route to {B} for its whole set, its owner menu, and Choose per selector's Apply owners (spec L435-L439).
 * `facet.routeContested` isn't this: it takes every contested selector of a facet, across sets.
 *
 * The edit goes through S1's `edit`: the analysis engine narrates what it resolved ("Resolved:
 * `sendMessage · 0xcdfe7f5c` and `supportsAttribute · 0xdc680a0f` route to HyperlaneGatewayAdapter.", spec
 * L438), else the summary is logged, and the status region says it. While the session is read-only nothing
 * changes and the reason is said.
 */
import type { Catalog, EditResult, Hex4, Project } from "@lattice-studio/core";
import { plural, routeSelector } from "@lattice-studio/core";
import { announce, getCatalog, log, session } from "@/contracts";
import { edit, summaryLine } from "@/state";

export type OwnerChoice = { selector: Hex4; facet: string };

/** Routes each selector to its facet on `project`, as one result. Pure. */
export function routeAll(project: Project, catalog: Catalog, choices: readonly OwnerChoice[]): EditResult {
  let next = project;
  const routed: OwnerChoice[] = [];
  const refusals: string[] = [];
  for (const choice of choices) {
    const result = routeSelector(next, catalog, choice.selector, choice.facet);
    if (result.changed) {
      next = result.project;
      routed.push(choice);
    } else {
      refusals.push(result.summary);
    }
  }
  if (routed.length === 0) return { project, changed: false, summary: refusals[0] ?? "Nothing to route." };
  const first = routed[0];
  const facets = new Set(routed.map((c) => c.facet));
  const summary =
    routed.length === 1 && first
      ? routeSelector(project, catalog, first.selector, first.facet).summary
      : facets.size === 1 && first
        ? `Routed ${plural(routed.length, "selector")} to ${first.facet}`
        : `Chose owners for ${plural(routed.length, "selector")}`;
  return { project: next, changed: true, summary };
}

/** Says `text` in the console and the status region. */
function say(text: string): void {
  log({ tag: "Note", text });
  announce(text);
}

/**
 * Applies the choices as one undo step. Says why when nothing can change (read-only, no catalog, every
 * selector already routed that way). Returns whether the document changed.
 */
export function applyOwners(choices: readonly OwnerChoice[]): boolean {
  const readOnly = session.get().readOnly;
  if (readOnly !== null) {
    say(readOnly);
    return false;
  }
  const catalog = getCatalog();
  if (!catalog) {
    say("The catalog hasn't loaded yet.");
    return false;
  }
  // S1's edit: one undo step, narration of what resolved, and the summary as a console line when nothing
  // resolved (an owner moved off a default), so no choice is ever silent; a no-op says why.
  return edit((p) => routeAll(p, catalog, choices), { fallback: summaryLine }).changed;
}
