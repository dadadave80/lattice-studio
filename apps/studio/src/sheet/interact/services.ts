/**
 * S4e's registrations (contracts `sheet.ts`, found by `discover.ts`): the interactions spread onto
 * `<ReactFlow>`, the interactions layer (marquee, Move to…, the catalog drop ghost and the context menus, in
 * their own chunk), and how a card takes focus (S9's `provideCardFocus`: panned into view first).
 */
import { provideSheetInteractions, registerSheetLayer } from "@/contracts";
import { provideCardFocus } from "@/a11y/focus";
import { focusCardInView } from "./focus";
import { InteractionsLayer } from "./InteractionsLayer";
import { useSheetInteractionProps } from "./use-sheet-interactions";

provideSheetInteractions(useSheetInteractionProps);
registerSheetLayer({ id: "interactions", order: 20, Component: InteractionsLayer });
provideCardFocus(focusCardInView);
