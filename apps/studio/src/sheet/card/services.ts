/**
 * S4a's registrations (contracts `sheet.ts`, found by `discover.ts`): the facet card as React Flow's "facet"
 * node type, and the layer that writes the sheet's zoom for 1/zoom strokes. Both use React Flow, so they load
 * with the canvas (`parts.ts`), not in the entry.
 */
import { registerSheetParts } from "@/sheet/canvas/parts";

registerSheetParts(() => import("./parts"));
