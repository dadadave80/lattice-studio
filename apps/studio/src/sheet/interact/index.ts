/**
 * Sheet interactions (WP-S4e): selecting, moving, nudging and reaching cards by pointer, touch and keyboard
 * (Flow 3, Flow 8, IR L14-L58, spec L749-L766). `services.ts` plugs them into S4b's sheet; `commands.ts`
 * registers the keyboard and menu commands. What other modules may use:
 *
 * - `openSheetMenu(target, client, invoker)`: opens the card, pin or sheet context menu (IR L190-L197).
 * - `startMoveTo()` / `cancelMoveTo()`: Move to… for the selection (S5b's Structure tree offers it too).
 * - `focusCardInView(facet)`: how a card takes focus (panned into view first), as S9's `focusCard` uses it.
 */
export { interactCommands } from "./commands";
export { focusCardInView } from "./focus";
export { cancelMoveTo, startMoveTo } from "./move-to";
export { closeSheetMenu, openSheetMenu } from "./menu-state";
export type { MenuRequest, MenuTarget } from "./menu-state";
export { selectionWords } from "./selection";
