/**
 * Sheet interactions (WP-S4e): selecting, moving, nudging and reaching cards by pointer, touch and keyboard
 * (Flow 3, Flow 8, IR L14-L58, spec L749-L766). `services.ts` plugs them into S4b's sheet; `commands.ts`
 * registers the keyboard and menu commands. Other modules reach them through the registry: `sheet.moveTo` is
 * Move to… for the selection (S5b's Structure tree offers it too), `facet.removeSelected` removes it with focus
 * moving per spec L755. The rest (handlers, runs, the layer) loads after the first paint (`runtime.ts`).
 *
 * - `focusCardInView(facet)`: how a card takes focus (panned into view first), as S9's `focusCard` uses it.
 */
export { interactCommands } from "./commands";
export { focusCardInView } from "./card-focus";
