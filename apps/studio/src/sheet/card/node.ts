/**
 * The card's interface to the sheet (S4b builds the nodes, S4c the edges, S4e the interactions):
 *
 * - Node type `FACET_NODE_TYPE` ("facet"), registered by `services.ts`. The node's `id` is the facet name; the
 *   card reads everything else itself through narrow selectors (spec L825), so `data` can stay empty.
 * - `facetNodeA11y(facet)`: spread onto the node. React Flow's wrapper is the focusable element (S9), so the
 *   group role, "facet card" and the name and description the card renders (spec L745) go on it by reference.
 *   They never change for a facet, so the node object doesn't have to change when the card's words do.
 * - Handles: `pinHandleId(selector)` on each drawn pin row, on the card's pin side, and
 *   `dependencyHandleId(side)` at the header's middle on both sides, where C9's `routeTraces` anchors
 *   dependency traces. Each id exists as a source and as a target handle.
 * - `SHEET_ZOOM_VAR`: the sheet's zoom, set on `.react-flow` by the card-zoom layer, so strokes scale with 1/zoom
 *   (spec L772) without re-rendering a card per zoom step.
 */
import type { Hex4 } from "@lattice-studio/core";
import type { Node } from "@xyflow/react";

export const FACET_NODE_TYPE = "facet";

/** A facet card node: `id` is the facet name. */
export type FacetNode = Node<Record<string, unknown>, typeof FACET_NODE_TYPE>;

export const SHEET_ZOOM_VAR = "--lx-sheet-zoom";

/** The id of the hidden element holding the card's accessible name. */
export function cardNameId(facet: string): string {
  return `lx-card-${facet}-name`;
}

/** The id of the hidden element holding the card's description (connections and selection). */
export function cardDescriptionId(facet: string): string {
  return `lx-card-${facet}-description`;
}

/** What S4b spreads onto a facet node so its focusable wrapper reads as a named "facet card" group. */
export function facetNodeA11y(facet: string): Pick<FacetNode, "ariaRole" | "domAttributes"> {
  return {
    ariaRole: "group",
    domAttributes: {
      "aria-roledescription": "facet card",
      "aria-labelledby": cardNameId(facet),
      "aria-describedby": cardDescriptionId(facet),
    },
  };
}

/** A pin row's handle: the selector's hex (brief S4a). */
export function pinHandleId(selector: Hex4): string {
  return selector;
}

/** A dependency trace's handle, at the header's middle on `side`. */
export function dependencyHandleId(side: "left" | "right"): string {
  return `dependency-${side}`;
}
