/**
 * The canvas (WP-S4b): `<Sheet />` (React Flow, the project's viewport, every pan and zoom path, the dot grid,
 * Back to content and the minimap) and the view API the modules beside it use. Every function works with or
 * without a mounted sheet, and every move glides, or jumps with reduced motion.
 *
 * For S4e (interactions):
 * - **Selection is controlled.** `nodes` is built from `session.selection` (and the layout), so React Flow's own
 *   selecting (a click, the marquee) only emits `select` NodeChanges through `onNodesChange`, which the sheet
 *   passes on after keeping measurements. Nothing is selected until S4e writes the session; the same goes for
 *   positions (`position` changes) and the document.
 * - **Props.** `useSheetInteractions()` is spread first; the sheet sets these after it, so they can't be
 *   overridden: `nodes`, `nodeTypes`, `edgeTypes`, `defaultViewport`, zoom range, `disableKeyboardA11y`,
 *   `deleteKeyCode`, `zoomOnDoubleClick`, `onlyRenderVisibleElements`, `panActivationKeyCode`, `panOnDrag`,
 *   `panOnScroll`, `zoomOnScroll`, `zoomOnPinch`, `nodesConnectable`, `edgesFocusable`, `edgesReconnectable`,
 *   `proOptions`, `aria-label`, `className`, and under the Hand tool or Space `nodesDraggable` and
 *   `selectionOnDrag` (false). `onNodesChange` and `onMoveEnd` are composed: the sheet's runs, then S4e's.
 * - **Right-click on empty sheet.** React Flow swallows the pane's `contextmenu` while right drag pans, so the
 *   sheet doesn't pass `onPaneContextMenu` to it: it calls S4e's `onPaneContextMenu` itself for a right click
 *   that didn't move (in either platform order), the menu key and a long press (`use-pane-context-menu.ts`).
 *   Card menus still come through React Flow's `onNodeContextMenu`.
 * - **Focus and auto-pan.** A card (or a pin row) that takes focus is panned clear of the floating UI when the
 *   focus is `:focus-visible` or the card is entirely off-screen; a pointer press on a visible card never moves
 *   the view. Known gap: a script focus after a pointer interaction (S9's `focusCard` after a clicked Undo, a
 *   card partly hidden) isn't `:focus-visible`, so it doesn't pan; call `ensureVisible` before focusing.
 * - `panSheet(dx, dy, { store: false })` each frame for edge auto-scroll, then `storeSheetViewport()` once at the
 *   end; `panSheet` for arrow keys with no card focused (spec L766); `sheetViewport()` and `sheetSize()` for
 *   screen-to-sheet math.
 *
 * For S4d (chrome): run the commands (`sheet.zoomIn`, `sheet.zoomTo {zoom: 0.5}`, `sheet.zoomFit`,
 * `sheet.minimapToggle`, `tool.hand`…); the readout reads the zoom inside a layer with React Flow's
 * `useStore((s) => s.transform[2])` and formats it with `percent`. `Panel`s count as floating UI for auto-pan.
 *
 * For S4c (overlays): edges go in through React Flow's own edge state from a layer (`useReactFlow().setEdges`;
 * the sheet never passes `edges`); F8 brings a card into view with `ensureVisible` or `sheet.locate`.
 *
 * Anything floating over the sheet outside a React Flow `Panel` carries `SHEET_FLOAT_ATTRIBUTE`.
 */
export { edgeTypes, nodeTypes, Sheet } from "./Sheet";
export {
  cardInView, ensureElementVisible, ensureVisible, fitCards, locateCard, moveViewport, panSheet,
  SHEET_FLOAT_ATTRIBUTE, sheetSize, sheetViewport, storeSheetViewport, zoomSheet,
} from "./sheet-view";
export type { MoveOptions } from "./sheet-view";
export { LOCATE_ZOOM, MAX_ZOOM, MIN_ZOOM, percent, ZOOM_STOPS } from "./viewport-math";
