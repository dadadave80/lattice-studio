/**
 * The facet card (WP-S4a). `services.ts` registers it as React Flow's "facet" node type; S4b builds nodes as
 * `{ id: facet, type: FACET_NODE_TYPE, position, ...facetNodeA11y(facet) }` and needs nothing else in `data`.
 * `node.ts` documents the handle ids S4c's edges use and the zoom variable; `init-mark.ts` is S4d's badge slot;
 * `card-model.ts` is the pure derivation (pin states, tooltips, borders, words) other views can reuse.
 */
export { FacetCard } from "./FacetCard";
export {
  cardDescriptionId, cardNameId, dependencyHandleId, FACET_NODE_TYPE, facetNodeA11y, pinHandleId, SHEET_ZOOM_VAR,
} from "./node";
export type { FacetNode } from "./node";
export { provideInitMark, useInitMark } from "./init-mark";
export type { InitMark } from "./init-mark";
export {
  cardAnalysis, cardView, describeCard, pinView, sameCardAnalysis, visibleRows,
} from "./card-model";
export type { CardAnalysis, CardBorder, CardView, PinState, PinView, TooltipCopy } from "./card-model";
