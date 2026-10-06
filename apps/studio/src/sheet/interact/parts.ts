/** S4e's canvas part, loaded with the canvas (`services.ts`, `sheet/canvas/parts.ts`): the interactions layer. */
import { registerSheetLayer } from "@/contracts";
import { InteractionsLayer } from "./InteractionsLayer";

registerSheetLayer({ id: "interactions", order: 20, Component: InteractionsLayer });
