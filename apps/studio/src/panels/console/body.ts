/**
 * The console body's lazy boundary (spec L822): everything the drawer shows under its header, and what the
 * console's commands do when they run. One chunk, reached only through `loadConsoleBody()`, so the entry keeps
 * the registrations, the drawer frame and the summary line.
 */
export { ConsoleBody } from "./ConsoleBody";
export { briefFile, exportFailed, exportSafe, saveExport } from "./actions";
export { findOnSheet, findSummary, firstAnchor, foundFacets } from "./find";
export { locatable, selectAndLocate } from "./locate";
export { problemLines } from "./problem-lines";
export { help } from "./verbs";
export { ExportItems } from "./ExportItems";
export { warmHighlighter } from "./highlight";
