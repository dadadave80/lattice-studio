/**
 * The version every export is headed with (spec L508: "headed with the recipe hash, the catalog tag and the
 * Studio version"), read from the app's package.json as the CLI reads its own. Imported by the lazy exporter
 * chunk and by the console body's recipe.json notes (`recipe-notes.ts`), never by the entry.
 */
import studio from "../../../../package.json" with { type: "json" };

export const STUDIO_VERSION: string = studio.version;
