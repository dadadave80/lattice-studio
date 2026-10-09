/**
 * Where the recipe schema is hosted (spec L992, HANDOFF D11): the committed `apps/studio/public/schema/recipe.v1.json`
 * on `main`, served raw by GitHub. lattice.wtf will host it later; recipes exported before then keep this URL for
 * good, so that path must stay valid on `main` (apps/studio/build/recipe-schema.test.ts fails if the file moves).
 * One exported constant so every caller (recipe.json's `$schema`, the JSON Schema's `$id`) updates together.
 */
export const RECIPE_SCHEMA_URL = "https://raw.githubusercontent.com/dadadave80/lattice-studio/main/apps/studio/public/schema/recipe.v1.json";
