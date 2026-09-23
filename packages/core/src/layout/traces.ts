import type { RouteTracesFn } from "../model/api";
import type { Facet } from "../model/catalog";
import type { Hex4 } from "../model/hex";
import type { CardLayout, LayoutMetrics, Rect, Trace } from "../model/layout";
import { type Anchor, cardRects, orthoRoute, rectOf, routeMid } from "./geometry";
import { collisions, contestedByFacet, pinsPad, visibleSelectors } from "./rows";

type Side = Anchor["side"];

/** Which side of each card a trace between them leaves from: facing sides, or both right when they share a column. */
function facingSides(from: Rect, to: Rect): [Side, Side] {
  if (to.x >= from.x + from.width) return ["right", "left"];
  if (to.x + to.width <= from.x) return ["left", "right"];
  return ["right", "right"];
}

function headerAnchor(r: Rect, side: Side, metrics: LayoutMetrics): Anchor {
  return { x: side === "right" ? r.x + r.width : r.x, y: r.y + metrics.headerHeight / 2, side };
}

/**
 * The pin-side anchor of `selector`'s row, or null when the card doesn't draw it. A card drawn shorter than its
 * rows (compact) anchors at its tick strip instead.
 */
function pinAnchor(
  r: Rect,
  entry: CardLayout,
  facet: Facet,
  selector: Hex4,
  contested: readonly Hex4[],
  metrics: LayoutMetrics,
): Anchor | null {
  const row = visibleSelectors(facet, entry.expanded === true, contested, metrics).indexOf(selector);
  if (row < 0) return null;
  const y = r.y + metrics.headerHeight + pinsPad(metrics) + row * metrics.rowHeight + metrics.rowHeight / 2;
  const x = entry.pins === "right" ? r.x + r.width : r.x;
  return { x, y: Math.min(y, r.y + r.height - metrics.rowHeight / 2), side: entry.pins };
}

/**
 * The sheet's connections (spec L480, L823): one dependency trace per met requirement and one 2 px tie per pair
 * of contenders for each unresolved collision, never one edge per selector.
 *
 * - A dependency trace runs, for each hard requirement (a convention, DEP-02, draws none), from the dependent's
 *   header to the first placed facet in the requirement's `anyOf`,
 *   leaving from the sides that face each other, labelled "needs ERC4626" at its longest segment's midpoint.
 * - A tie runs between the contested selector's pin rows, on each card's pin side, one lane per selector so a
 *   pair's ties don't coincide. Three or more contenders are chained in catalog order (A–B, B–C).
 *
 * Paths are orthogonal and detour above or below cards in their way. Order: dependencies in recipe order, then
 * ties in problem order.
 */
export const routeTraces: RouteTracesFn = ({ layout, sizes, recipe, catalog, analysis, metrics }) => {
  const facets = new Map(catalog.facets.map((f) => [f.name, f]));
  const obstacles = cardRects(layout, sizes, metrics).map((c) => c.rect);
  const onSheet = (name: string): boolean => layout[name] !== undefined && recipe.facets.includes(name);
  const out: Trace[] = [];
  const seen = new Set<string>();

  for (const name of recipe.facets) {
    const facet = facets.get(name);
    const from = rectOf(layout, sizes, name, metrics);
    if (!facet || !from || !onSheet(name)) continue;
    facet.requires.forEach((requirement, lane) => {
      if (requirement.strength !== "hard") return;
      const provider = requirement.anyOf.find((option) => option !== name && onSheet(option));
      const to = provider === undefined ? null : rectOf(layout, sizes, provider, metrics);
      if (provider === undefined || !to) return;
      const id = `needs:${name}:${provider}`;
      if (seen.has(id)) return;
      seen.add(id);
      const [a, b] = facingSides(from, to);
      const points = orthoRoute(headerAnchor(from, a, metrics), headerAnchor(to, b, metrics), lane, obstacles, metrics.grid);
      out.push({ id, kind: "dependency", from: name, to: provider, points, mid: routeMid(points), label: `needs ${provider}` });
    });
  }

  const list = collisions(analysis);
  const contested = contestedByFacet(list);
  const lanes = new Map<string, number>();
  for (const { selector, contenders } of list) {
    const present = contenders.filter(onSheet);
    for (let i = 0; i + 1 < present.length; i++) {
      const a = present[i];
      const b = present[i + 1];
      if (a === undefined || b === undefined) continue;
      const anchors = [a, b].map((name) => {
        const entry = layout[name];
        const facet = facets.get(name);
        const r = rectOf(layout, sizes, name, metrics);
        return entry && facet && r ? pinAnchor(r, entry, facet, selector, contested.get(name) ?? [], metrics) : null;
      });
      const [from, to] = anchors;
      if (!from || !to) continue;
      const pair = `${a}+${b}`;
      const lane = lanes.get(pair) ?? 0;
      lanes.set(pair, lane + 1);
      const points = orthoRoute(from, to, lane, obstacles, metrics.grid);
      out.push({ id: `tie:${selector}:${pair}`, kind: "tie", from: a, to: b, points, mid: routeMid(points), selector });
    }
  }
  return out;
};
