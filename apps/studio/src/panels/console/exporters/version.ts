/**
 * The version every export is headed with (spec L508: "headed with the recipe hash, the catalog tag and the
 * Studio version"), read from the app's package.json as the CLI reads its own. Imported only by the lazy
 * exporter chunks.
 */
import studio from "../../../../package.json" with { type: "json" };

export const STUDIO_VERSION: string = studio.version;
