/**
 * Card rectangles for Fit, Locate and auto-pan, from token-computed sizes (C9's `cardSize`), never measured
 * ones, so where the view goes never depends on what the view currently shows (spec L824).
 */
import type { Analysis, Catalog, Layout, Rect, Sizes } from "@lattice-studio/core";
import { cardSize, contestedSelectors, contentBounds, isNotImplemented } from "@lattice-studio/core";
import { layoutMetrics } from "@/contracts";

/** A card's size before the catalog knows it: the header and footer alone. */
export function fallbackCardSize(): { width: number; height: number } {
  return { width: layoutMetrics.cardWidth, height: layoutMetrics.headerHeight + layoutMetrics.footerHeight };
}

/** Every placed card's full-size dimensions (expanded flag, pins and contested rows included). */
export function cardSizes(layout: Layout, catalog: Catalog | null, analysis: Analysis): Sizes {
  const sizes: Sizes = {};
  let contested: ((name: string) => ReturnType<typeof contestedSelectors>) | null = null;
  for (const name of Object.keys(layout)) {
    const entry = layout[name];
    const facet = catalog?.facets.find((f) => f.name === name);
    if (!entry || !facet) {
      sizes[name] = fallbackCardSize();
      continue;
    }
    try {
      contested ??= (n) => contestedSelectors(analysis, n);
      const size = cardSize(facet, {
        metrics: layoutMetrics,
        expanded: entry.expanded === true,
        pins: entry.pins,
        compact: false,
        contested: contested(name),
      });
      sizes[name] = { width: size.width, height: size.height };
    } catch (error) {
      if (!isNotImplemented(error)) throw error;
      sizes[name] = fallbackCardSize();
    }
  }
  return sizes;
}

/** The bounding box of `names` (every card when omitted), in sheet units; null when none is placed. */
export function cardsBounds(layout: Layout, sizes: Sizes, names?: readonly string[]): Rect | null {
  if (!names) return contentBounds(layout, sizes);
  const picked: Layout = {};
  for (const name of names) {
    const entry = layout[name];
    if (entry) picked[name] = entry;
  }
  return Object.keys(picked).length ? contentBounds(picked, sizes) : null;
}

/** One card's rectangle in sheet units, or null when it isn't placed. */
export function cardRect(layout: Layout, sizes: Sizes, name: string): Rect | null {
  const entry = layout[name];
  if (!entry) return null;
  const size = sizes[name] ?? fallbackCardSize();
  return { x: entry.x, y: entry.y, width: size.width, height: size.height };
}
