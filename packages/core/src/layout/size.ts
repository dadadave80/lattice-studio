import type { CardSizeFn } from "../model/api";
import type { Hex4 } from "../model/hex";
import type { LayoutMetrics, Size } from "../model/layout";
import { collapsible, pinsPad, visibleSelectors } from "./rows";

/**
 * A card's size from tokens, never measured (spec L824). Top to bottom:
 *
 * - header (`headerHeight`);
 * - `pinsPad`, then one `rowHeight` row per drawn selector (row `i` is centered at
 *   `headerHeight + pinsPad + i·rowHeight + rowHeight/2`), then the "+ n more" or "Collapse" control row
 *   when the card has more than `expandThreshold` selectors and it has something to show or hide, then `pinsPad`;
 * - footer (`footerHeight`).
 *
 * Collapsed, a card draws every contested selector (they never hide) topped up to `collapsedRows` with the
 * rest in order. Compact (below 40% zoom, spec L481): header plus a one-row tick strip, no rows, no footer.
 */
export const cardSize: CardSizeFn = (facet, opts) => {
  const { metrics } = opts;
  if (opts.compact) {
    return { width: metrics.cardWidth, height: metrics.headerHeight + metrics.rowHeight, rows: 0, hidden: 0 };
  }
  const rows = visibleSelectors(facet, opts.expanded, opts.contested, metrics).length;
  const hidden = facet.selectors.length - rows;
  const control = collapsible(facet, metrics) && (opts.expanded || hidden > 0) ? 1 : 0;
  const height =
    metrics.headerHeight + 2 * pinsPad(metrics) + (rows + control) * metrics.rowHeight + metrics.footerHeight;
  return { width: metrics.cardWidth, height, rows, hidden };
};

/** Raw instances show three selectors until expanded, with a control row whenever there are more. */
export function rawFacetCardSize(selectors: readonly Hex4[], expanded: boolean, metrics: LayoutMetrics): Size {
  const rows = expanded ? selectors.length : Math.min(selectors.length, 3);
  return { width: metrics.cardWidth, height: metrics.headerHeight + metrics.footerHeight + metrics.grid * 2
    + (rows + (selectors.length > 3 ? 1 : 0)) * metrics.rowHeight };
}
