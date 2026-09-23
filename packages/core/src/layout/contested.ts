import type { Analysis } from "../model/analysis";
import type { Hex4 } from "../model/hex";
import { collisions, contestedByFacet } from "./rows";

/**
 * The contested selectors `cardSize({ contested })` takes: the selector of every unresolved collision (SEL-01)
 * whose `params.contenders` names `facet`, in problem order. Without `facet`, every contested selector once.
 * Seams and chosen or default owners aren't collisions, so never use `routing[s].contenders.length >= 2`: that
 * would keep rows open that `tidy` and `routeTraces` don't, and ties would miss the drawn rows.
 * A facet that contends nothing gets [].
 */
export function contestedSelectors(analysis: Analysis, facet?: string): Hex4[] {
  const list = collisions(analysis);
  if (facet === undefined) return [...new Set(list.map((c) => c.selector))];
  return contestedByFacet(list).get(facet) ?? [];
}
