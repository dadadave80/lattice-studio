import type { TidyFn } from "../model/api";
import type { Catalog, Facet } from "../model/catalog";
import type { Hex4 } from "../model/hex";
import type { Layout, LayoutMetrics, Point, Rect, Size, Sizes } from "../model/layout";
import { cardRects, center, compareText, fallbackSize, nearestFree, snapUp, unionRect } from "./geometry";
import { collisions, contestedByFacet } from "./rows";
import { cardSize } from "./size";

/**
 * Tidy's spacing, in grid units (the board's `COL_STEP 304`, `ROW_GAP 40`, `COLUMN_MAX 1040`, origin 96):
 * the gap between columns leaves room for traces and their labels.
 */
const COLUMN_GAP = 9;
const ROW_GAP = 5;
const COLUMN_MAX = 130;
const ORIGIN = 12;

/** New cards' selector column side, as the board draws a fresh card. */
const DEFAULT_PINS = "right";

type Card = { name: string; order: number; size: Size };

/** Catalog order, then (for cards the catalog doesn't know) name order. */
function catalogOrder(catalog: Catalog): (a: string, b: string) => number {
  const index = new Map(catalog.facets.map((f, i) => [f.name, i]));
  return (a, b) => {
    const ia = index.get(a) ?? Number.POSITIVE_INFINITY;
    const ib = index.get(b) ?? Number.POSITIVE_INFINITY;
    return ia === ib ? compareText(a, b) : ia - ib;
  };
}

/**
 * Each card's band: 0 with no placed provider, else one more than its deepest placed provider (every placed
 * option of every `requires` entry counts as a provider). A dependency cycle is cut where the walk re-enters it.
 */
function bands(names: readonly string[], facets: ReadonlyMap<string, Facet>): Map<string, number> {
  const inSet = new Set(names);
  const band = new Map<string, number>();
  const visiting = new Set<string>();
  const depth = (name: string): number => {
    const known = band.get(name);
    if (known !== undefined) return known;
    if (visiting.has(name)) return -1;
    visiting.add(name);
    let d = 0;
    for (const r of facets.get(name)?.requires ?? []) {
      for (const provider of r.anyOf) {
        if (provider === name || !inSet.has(provider)) continue;
        d = Math.max(d, depth(provider) + 1);
      }
    }
    visiting.delete(name);
    band.set(name, d);
    return d;
  };
  for (const name of names) depth(name);
  return band;
}

/**
 * Bands as columns, left to right, from `origin`: providers before dependents, catalog order within a band.
 * A band wraps into another column once it is `COLUMN_MAX` tall.
 */
function arrange(cards: readonly Card[], band: ReadonlyMap<string, number>, origin: Point, metrics: LayoutMetrics): Map<string, Point> {
  const g = metrics.grid;
  const step = snapUp(metrics.cardWidth + COLUMN_GAP * g, metrics.snap);
  const out = new Map<string, Point>();
  const maxBand = Math.max(0, ...cards.map((c) => band.get(c.name) ?? 0));
  let column = 0;
  for (let b = 0; b <= maxBand; b++) {
    const members = cards.filter((c) => (band.get(c.name) ?? 0) === b).sort((p, q) => p.order - q.order);
    if (members.length === 0) continue;
    let y = origin.y;
    for (const card of members) {
      if (y > origin.y && y + card.size.height > origin.y + COLUMN_MAX * g) {
        column++;
        y = origin.y;
      }
      out.set(card.name, { x: origin.x + column * step, y });
      y = snapUp(y + card.size.height + ROW_GAP * g, metrics.snap);
    }
    column++;
  }
  return out;
}

/** Sizes as the sheet draws them at full size: `cardSize` with each card's expanded flag and contested rows. */
function tidySizes(
  names: readonly string[],
  layout: Layout,
  facets: ReadonlyMap<string, Facet>,
  contested: ReadonlyMap<string, readonly Hex4[]>,
  metrics: LayoutMetrics,
): Sizes {
  const sizes: Sizes = {};
  for (const name of names) {
    const facet = facets.get(name);
    const entry = layout[name];
    sizes[name] = facet
      ? cardSize(facet, {
          metrics,
          expanded: entry?.expanded === true,
          pins: entry?.pins ?? DEFAULT_PINS,
          compact: false,
          contested: contested.get(name) ?? [],
        })
      : fallbackSize(metrics);
  }
  return sizes;
}

/**
 * Tidy (spec L476): deterministic dependency bands. The whole sheet (every placed facet and every card on the
 * sheet) is laid out from a fixed origin, so the result depends only on the cards, the catalog and the
 * analysis, never on where the cards were. With `selection`, only those cards on the sheet are arranged the
 * same way, centered on their current bounding box's center, and the block then slides to the nearest free
 * spot so it lands on no other card. Pins and expanded flags are kept; a placed facet with no layout entry
 * gets one with pins on the right.
 */
export const tidy: TidyFn = (project, catalog, analysis, metrics, selection) => {
  const { layout } = project;
  const facets = new Map(catalog.facets.map((f) => [f.name, f]));
  const contested = contestedByFacet(collisions(analysis));

  const all = [...new Set([...project.recipe.facets, ...Object.keys(layout)])].sort(catalogOrder(catalog));
  const picked = selection === undefined ? null : new Set(selection);
  const chosen = picked ? all.filter((n) => layout[n] !== undefined && picked.has(n)) : all;
  if (chosen.length === 0) return picked ? { ...layout } : layout;

  const sizes = tidySizes(all, layout, facets, contested, metrics);
  const cards = chosen.map((name, order): Card => ({ name, order, size: sizes[name] ?? fallbackSize(metrics) }));
  const origin = { x: ORIGIN * metrics.grid, y: ORIGIN * metrics.grid };
  let positions = arrange(cards, bands(chosen, facets), origin, metrics);

  if (picked) {
    const others: Layout = {};
    for (const name of all) {
      const entry = layout[name];
      if (entry && !picked.has(name)) others[name] = entry;
    }
    positions = placeBlock(positions, cards, layout, cardRects(others, sizes, metrics).map((c) => c.rect), metrics);
  }

  const out: Layout = picked ? { ...layout } : {};
  for (const name of chosen) {
    const at = positions.get(name);
    if (!at) continue;
    const entry = layout[name];
    out[name] = entry ? { ...entry, x: at.x, y: at.y } : { x: at.x, y: at.y, pins: DEFAULT_PINS };
  }
  return out;
};

/** Moves an arranged selection so it's centered where the selection was, then clear of `obstacles`. */
function placeBlock(
  positions: ReadonlyMap<string, Point>,
  cards: readonly Card[],
  layout: Layout,
  obstacles: readonly Rect[],
  metrics: LayoutMetrics,
): Map<string, Point> {
  const rectsAt = (at: (c: Card) => Point | undefined): Rect[] =>
    cards.flatMap((c) => {
      const p = at(c);
      return p ? [{ x: p.x, y: p.y, width: c.size.width, height: c.size.height }] : [];
    });
  const before = unionRect(rectsAt((c) => layout[c.name]));
  const block = unionRect(rectsAt((c) => positions.get(c.name)));
  const out = new Map(positions);
  if (!before || !block) return out;
  const mid = center(before);
  const target = { x: mid.x - block.width / 2, y: mid.y - block.height / 2 };
  const at = nearestFree(obstacles, target, { width: block.width, height: block.height }, metrics.snap);
  for (const [name, p] of positions) out.set(name, { x: p.x + at.x - block.x, y: p.y + at.y - block.y });
  return out;
}
