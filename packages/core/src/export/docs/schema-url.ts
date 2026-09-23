/**
 * Where the recipe schema is hosted (spec L992, HANDOFF D11). Undecided until David picks a domain; kept as
 * one exported constant so every caller (recipe.json's `$schema`, the JSON Schema's `$id`) updates together.
 */
export const RECIPE_SCHEMA_URL = "https://lattice-studio.invalid/schema/recipe.v1.json";
