/**
 * S4e's registrations (contracts `sheet.ts`, found by `discover.ts`): the interactions spread onto
 * `<ReactFlow>`, the interactions layer (marquee, Move to…, the catalog drop ghost and the context menus; it uses
 * React Flow, so it loads with the canvas, `parts.ts`), and how a card takes focus (S9's `provideCardFocus`:
 * panned into view first).
 */
import { provideSheetInteractions } from "@/contracts";
import { provideCardFocus } from "@/a11y/focus";
import { registerSheetParts } from "@/sheet/canvas/parts";
import { focusCardInView } from "./card-focus";
import { useSheetInteractionProps } from "./use-sheet-interactions";

provideSheetInteractions(useSheetInteractionProps);
registerSheetParts(() => import("./parts"));
provideCardFocus(focusCardInView);
