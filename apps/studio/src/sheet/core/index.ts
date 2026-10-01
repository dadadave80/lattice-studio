/**
 * The pinned diamond core on the sheet: the core cell (a screen-space Panel beside the title block, layer order
 * 32, registered by `services.ts`), the traces cards draw into it (`CoreTraces.tsx`, `painter.ts`), and
 * `core.select` (`commands.ts`). The cards' own ground glyphs and cut-plan stamps live in `../card`. `model.ts`
 * and `geometry.ts` are the pure derivations other views can reuse; `copy.ts` holds the words. The registrations
 * stay out of this barrel: `discover.ts` evaluates them.
 */
export { CELL_LABEL, CORE, CORE_TAGLINE, CUT, DROP_REFUSED, EMPTY_HINT, ERC165, FALLBACK, LOUPE } from "./copy";
export { cutName, cutRow, diamondName, erc165Name, fallbackName, fallbackText, loupeName, loupeText } from "./model";
export type { CutRow } from "./model";
export { glyphAnchor, glyphScale, GUTTER, gutterX, RAIL_GAP, stubOffsets, tracePaths } from "./geometry";
export type { PinSide, TraceInput, TracePaths, Transform } from "./geometry";
export { FLASH_MS, placedBetween } from "./placement";
