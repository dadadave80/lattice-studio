import type { Route, Routing } from "../model/analysis";
import type { ComputeRoutingFn } from "../model/api";
import type { Hex4 } from "../model/hex";
import { activeSeam, allowedServers, type RecipeView, recipeView } from "./view";

/**
 * Who serves every selector a placed facet exports (spec L300-L303, R19), keys sorted, contenders in catalog
 * order. First match wins:
 *
 * 1. Excluded (`recipe.exclude`): listed with its contenders but no `owner` (it isn't routed; `stats.excluded`
 *    counts it), so every placed facet's selectors stay visible through `contenders`.
 * 2. A seam is active (every facet in its `when` is placed) and an allowed facet serves it: the first placed
 *    facet in `anyOf`, `via: "seam"` (spec L302, IR L102), whatever `owners` says. An owner outside `anyOf`
 *    doesn't move it; SEM-01 anchors that owner. With none of `anyOf` placed, resolution falls through to the
 *    rules below and SEM-01 blocks.
 * 3. A single contender: `via: "only"`.
 * 4. An explicit owner among the contenders: `via: "chosen"`.
 * 5. Exactly one contender lists it in `defaultOwnerOf`: `via: "default"`.
 * 6. Unresolved: no `owner`, `via: "chosen"` (the choice SEL-01 asks for is still to be made).
 *
 * `owner` is optional for exactly these (spec L262), but the frozen `via` has no value for "excluded" or
 * "unresolved", so both read `via: "chosen"` without an owner; `recipe.exclude` tells them apart.
 */
export const computeRouting: ComputeRoutingFn = (recipe, catalog) => {
  const view = recipeView(recipe, catalog);
  const routing: Routing = {};
  for (const [selector, contenders] of view.contenders) routing[selector] = resolve(view, selector, contenders);
  return routing;
};

function resolve(view: RecipeView, selector: Hex4, contenders: string[]): Route {
  if (view.exclude.has(selector)) return { contenders: [...contenders], via: "chosen" };
  const owner = view.owners.get(selector);
  const seam = activeSeam(view, selector);
  if (seam !== undefined) {
    const pick = allowedServers(view, seam, selector)[0];
    if (pick !== undefined) return { owner: pick, contenders: [...contenders], via: "seam" };
  }
  const only = contenders.length === 1 ? contenders[0] : undefined;
  if (only !== undefined) return { owner: only, contenders: [...contenders], via: "only" };
  if (owner !== undefined && contenders.includes(owner)) return { owner, contenders: [...contenders], via: "chosen" };
  const defaults = contenders.filter((name) => {
    return view.byName.get(name)?.defaultOwnerOf?.some((s) => s.toLowerCase() === selector) ?? false;
  });
  const byDefault = defaults.length === 1 ? defaults[0] : undefined;
  if (byDefault !== undefined) return { owner: byDefault, contenders: [...contenders], via: "default" };
  return { contenders: [...contenders], via: "chosen" };
}
