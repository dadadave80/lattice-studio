/** S4a's canvas parts, loaded with the canvas (`services.ts`, `sheet/canvas/parts.ts`). */
import { registerNodeType, registerSheetLayer } from "@/contracts";
import { CardZoomScale } from "./CardZoomScale";
import { FacetCard } from "./FacetCard";
import { FACET_NODE_TYPE } from "./node";

registerNodeType(FACET_NODE_TYPE, FacetCard);
registerSheetLayer({ id: "card-zoom", order: 0, Component: CardZoomScale });
