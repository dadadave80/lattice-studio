import { activeSeams, allowedServers, recipeView, signatureOf } from "../analysis/view";
import type { Check } from "../model/analysis";
import type { Hex4 } from "../model/hex";
import { type Anchor, type Problem, problem, problemId } from "../model/problems";

/**
 * SEM-01 (spec L302, L316, R19): for each active seam (every facet in `when` placed) whose selector isn't
 * excluded, either
 * - none of `anyOf` is placed to serve it (`nonePlaced`): fixes place each allowed facet; or
 * - an explicit owner outside `anyOf` is placed and exports it: the seam still wins routing (`via: "seam"`),
 *   and the problem anchors the stale owner until it's rerouted or removed. Fixes: one Route, to the first
 *   placed facet in `anyOf` (where the seam routes it), and Remove the stale owner.
 * An owner that isn't placed or doesn't export the selector is SEL-05's, not this check's.
 */
export const checkSem: Check = ({ recipe, catalog, routing }) => {
  const view = recipeView(recipe, catalog);
  const out: Problem[] = [];
  for (const seam of activeSeams(view)) {
    const selector = seam.selector.toLowerCase() as Hex4;
    if (view.exclude.has(selector)) continue;
    const contenders = view.contenders.get(selector) ?? [];
    const allowed = allowedServers(view, seam, selector);
    const signature = signatureOf(catalog, selector) ?? selector;
    const id = problemId("SEM-01", selector);
    const base = { selector, signature, allowed: [...seam.anyOf], reason: seam.reason };
    if (allowed.length === 0) {
      const where: Anchor[] =
        contenders.length > 0
          ? contenders.map((facet) => ({ kind: "selector", selector, facet }))
          : seam.when.map((facet) => ({ kind: "facet", facet }));
      const fixes = seam.anyOf.map((facet) => ({ id: "facet.place" as const, args: { facet } }));
      out.push(problem("SEM-01", where, { ...base, nonePlaced: true }, fixes, { id }));
      continue;
    }
    const owner = view.owners.get(selector);
    if (owner === undefined || seam.anyOf.includes(owner) || !contenders.includes(owner)) continue;
    // One Route fix, to the facet the seam routes to: the first placed facet in `anyOf` (spec L302).
    const to = routing[selector]?.owner ?? allowed[0] ?? "";
    out.push(
      problem(
        "SEM-01",
        [{ kind: "selector", selector, facet: owner }],
        { ...base, owner, nonePlaced: false },
        [
          { id: "selector.route", args: { selector, facet: to } },
          { id: "facet.remove", args: { facets: [owner] } },
        ],
        { id },
      ),
    );
  }
  return out;
};
