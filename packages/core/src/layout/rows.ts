/**
 * Which pin rows a card draws, and which selectors are contested. Internal: `cardSize`, `tidy` and
 * `routeTraces` share it, so a tie always lands on a row the card actually shows.
 */
import type { Analysis } from "../model/analysis";
import type { Facet } from "../model/catalog";
import { type Hex4, isHex4 } from "../model/hex";
import type { LayoutMetrics } from "../model/layout";

/** A collision: a selector with no owner yet (SEL-01) and the placed facets exporting it, in catalog order. */
export type Collision = { selector: Hex4; contenders: string[] };

/**
 * The analysis's unresolved collisions, one per SEL-01 problem, in problem order. Seams and chosen or default
 * owners aren't collisions (spec L302-L303, L441), so only SEL-01 counts.
 */
export function collisions(analysis: Analysis): Collision[] {
  const out: Collision[] = [];
  for (const p of analysis.problems) {
    if (p.code !== "SEL-01") continue;
    const selector = p.params["selector"];
    const contenders = p.params["contenders"];
    if (!isHex4(selector) || !Array.isArray(contenders)) continue;
    const names = contenders.filter((c): c is string => typeof c === "string");
    if (names.length >= 2) out.push({ selector, contenders: names });
  }
  return out;
}

/** Contested selectors per facet name, from `collisions`. */
export function contestedByFacet(list: readonly Collision[]): Map<string, Hex4[]> {
  const out = new Map<string, Hex4[]>();
  for (const c of list) {
    for (const name of c.contenders) {
      const selectors = out.get(name) ?? [];
      if (!selectors.includes(c.selector)) selectors.push(c.selector);
      out.set(name, selectors);
    }
  }
  return out;
}

/** Padding above and below a card's pin rows: one grid step each (the board's `PINS_PAD`). */
export function pinsPad(metrics: LayoutMetrics): number {
  return metrics.grid;
}

/** The card shows a "+ n more" / "Collapse" control: it has more than `expandThreshold` selectors. */
export function collapsible(facet: Facet, metrics: LayoutMetrics): boolean {
  return facet.selectors.length > metrics.expandThreshold;
}

/**
 * The selectors a card draws as rows, in the facet's own order (spec L479, IR L105). Expanded, or with no more
 * than `expandThreshold` selectors: all of them. Collapsed: every contested selector (they never hide, PA bug
 * 21), filled up to `collapsedRows` with the facet's other selectors in order.
 */
export function visibleSelectors(
  facet: Facet,
  expanded: boolean,
  contested: readonly Hex4[],
  metrics: LayoutMetrics,
): Hex4[] {
  const all = facet.selectors.map((s) => s.hex);
  if (expanded || !collapsible(facet, metrics)) return all;
  const isContested = new Set(contested);
  const keep = new Set(all.filter((s) => isContested.has(s)));
  for (const s of all) {
    if (keep.size >= metrics.collapsedRows) break;
    keep.add(s);
  }
  return all.filter((s) => keep.has(s));
}
