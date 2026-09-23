/**
 * The canvas (WP-S4b): `<Sheet />` (React Flow, the project's viewport, every pan and zoom path, the dot grid,
 * Back to content and the minimap) and the view API the modules beside it use:
 *
 * - S4e (interactions): `ensureVisible(facet)` before focusing a card it moved to (the sheet already pans a
 *   card that takes keyboard focus); `panSheet(dx, dy)` for arrow keys with no card focused (spec L766);
 *   `sheetViewport()` and `sheetSize()` for screen-to-sheet math; `EDGE_ZONE` auto-scroll via `panSheet`.
 * - S4d (chrome): run the commands (`sheet.zoomIn`, `sheet.zoomTo {zoom: 0.5}`, `sheet.zoomFit`,
 *   `sheet.minimapToggle`, `tool.hand`…); the readout reads the zoom inside a layer with React Flow's
 *   `useStore((s) => s.transform[2])` and formats it with `percent`. Panels are floating UI automatically.
 * - S4c (overlays): edges go in through React Flow's own edge state from a layer (`useReactFlow().setEdges`;
 *   the sheet never passes `edges`); F8 moves to a card with `ensureVisible` or `sheet.locate`.
 * - Anything floating over the sheet outside a React Flow `Panel` carries `SHEET_FLOAT_ATTRIBUTE`.
 */
export { edgeTypes, nodeTypes, Sheet } from "./Sheet";
export {
  cardInView, ensureVisible, fitCards, locateCard, moveViewport, panSheet, SHEET_FLOAT_ATTRIBUTE, sheetSize,
  sheetViewport, zoomSheet,
} from "./sheet-view";
export { LOCATE_ZOOM, MAX_ZOOM, MIN_ZOOM, percent, ZOOM_STOPS } from "./viewport-math";
