/**
 * Studio's version, heading every export's description and the Save a copy dialog (spec L508; ruling R6), read
 * from the app's package.json as the CLI reads its own. Imported by lazy chunks only (the exporters, the console
 * body's recipe.json notes, the deploy review's Safe batch, the Save a copy dialog), never by the entry.
 */
import studio from "../../package.json" with { type: "json" };

export const STUDIO_VERSION: string = studio.version;
