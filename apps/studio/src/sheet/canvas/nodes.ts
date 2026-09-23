/**
 * React Flow nodes from the project's layout (spec L744, L825): one facet card per placed facet, built the way
 * S4a's `node.ts` asks, with the roving `tabIndex` merged into its `domAttributes`, so the card grid is one
 * Tab stop and React Flow's node wrapper stays the focusable element (S9).
 *
 * A node object keeps its identity until something it carries changes, so a drag frame or a selection change
 * hands React Flow new objects only for the cards it touched.
 */
import type { Anchor, Layout } from "@lattice-studio/core";
import { readingOrder } from "@/a11y/positions";
import { FACET_NODE_TYPE, facetNodeA11y, type FacetNode } from "@/sheet/card/node";

/** What React Flow measured, carried on the node so it isn't measured again every time the node changes. */
export type Measured = { width: number; height: number };

export type NodeInput = {
  layout: Layout;
  selection: readonly string[];
  /** The card that takes Tab focus (tabIndex 0); every other card is -1. */
  tabStop: string | null;
  measured: ReadonlyMap<string, Measured>;
};

/**
 * The card that holds the grid's Tab stop: the focus anchor's card, else the first selected card, else the
 * first card in reading order (IR L20), else none.
 */
export function tabStopOf(layout: Layout, focus: Anchor | null, selection: readonly string[]): string | null {
  const anchored = focus?.kind === "facet" ? focus.facet : focus?.kind === "selector" ? focus.facet : undefined;
  if (anchored !== undefined && layout[anchored]) return anchored;
  const selected = selection.find((name) => layout[name]);
  if (selected !== undefined) return selected;
  return readingOrder(layout)[0] ?? null;
}

type Cached = { key: string; node: FacetNode };

/** A node builder with its own identity cache; one per mounted sheet. */
export function nodeBuilder(): (input: NodeInput) => FacetNode[] {
  let cache = new Map<string, Cached>();
  return ({ layout, selection, tabStop, measured }) => {
    const selected = new Set(selection);
    const next = new Map<string, Cached>();
    const nodes: FacetNode[] = [];
    for (const [facet, entry] of Object.entries(layout)) {
      const size = measured.get(facet);
      const isSelected = selected.has(facet);
      const tabIndex = facet === tabStop ? 0 : -1;
      const key = `${entry.x},${entry.y},${isSelected ? 1 : 0},${tabIndex},${size ? `${size.width}x${size.height}` : "-"}`;
      const cached = cache.get(facet);
      if (cached && cached.key === key) {
        next.set(facet, cached);
        nodes.push(cached.node);
        continue;
      }
      const a11y = facetNodeA11y(facet);
      const node: FacetNode = {
        id: facet,
        type: FACET_NODE_TYPE,
        position: { x: entry.x, y: entry.y },
        data: {},
        selected: isSelected,
        ...a11y,
        domAttributes: { ...a11y.domAttributes, tabIndex },
        ...(size ? { measured: size } : {}),
      };
      next.set(facet, { key, node });
      nodes.push(node);
    }
    cache = next;
    return nodes;
  };
}
