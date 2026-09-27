import studio from "../../package.json" with { type: "json" };

/** Studio's version, heading the Save a copy dialog (ruling R6, spec L508). */
export const STUDIO_VERSION: string = studio.version;
