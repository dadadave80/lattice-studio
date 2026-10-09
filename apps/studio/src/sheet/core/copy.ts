/**
 * The core cell's words (the pinned diamond core). Sentence case here; the cell's small caps come from CSS. Plain
 * strings, so the entry's drop refusal and the lazy cell share one source and tests assert the same text.
 */
export const CORE = "Core";
export const CORE_TAGLINE = "The diamond's fixed part";
export const FALLBACK = "Fallback";
export const LOUPE = "Loupe";
export const ERC165 = "ERC-165";
export const CUT = "Cut";
/** The empty sheet's row in the cell, under the core's readout. */
export const EMPTY_HINT = "Facets you place plug in here. Their selectors are the wires.";
/** A catalog row dropped on the cell: nothing is placed, and the console says why. */
export const DROP_REFUSED = "The core takes no cards. Drop on the sheet.";
export const COLLAPSE_CELL = "Collapse the core cell";
export const EXPAND_CELL = "Expand the core cell";
/** The cell's accessible name (the toolbar's label). */
export const CELL_LABEL = "Core";
/** What selecting the core announces, and the console's `find` says when only the core matched. */
export const SELECTED_THE_CORE = "Selected the core.";
