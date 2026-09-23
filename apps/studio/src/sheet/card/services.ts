/**
 * S4a's registrations (contracts `sheet.ts`, found by `discover.ts`): the facet card as React Flow's "facet"
 * node type, and the layer that writes the sheet's zoom for 1/zoom strokes.
 */
import { registerNodeType, registerSheetLayer } from "@/contracts";
import { CardZoomScale } from "./CardZoomScale";
import { FacetCard } from "./FacetCard";
import { FACET_NODE_TYPE } from "./node";

registerNodeType(FACET_NODE_TYPE, FacetCard);
registerSheetLayer({ id: "card-zoom", order: 0, Component: CardZoomScale });
