/**
 * S6: the ⌘K command palette (IR L162-L168). The app mounts `CommandPalette` once; it stays empty until the
 * palette opens and loads the palette's chunk when idle or on the first ⌘K. Open it through `palette.open`
 * (`{ mode: "facets", at }` for Add facet here…), or `openPalette` from code that can't go through a command.
 */
export { CommandPalette } from "./CommandPalette";
export type { CommandPaletteProps } from "./CommandPalette";
export { closePalette, openPalette, usePaletteState } from "./palette-state";
export type { OpenOptions, PaletteMode, PaletteState } from "./palette-state";
export type { PaletteOpenArgs } from "./open-command";
