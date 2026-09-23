/**
 * Prints core's `recipeJsonSchema()` as formatted JSON. Run with Bun (`recipe-schema.ts` spawns it): Vite
 * loads its config under Node, which can't load core's TypeScript sources.
 */
import { recipeJsonSchema } from "@lattice-studio/core";
import { formatJson } from "./headers.ts";

if (import.meta.main) process.stdout.write(formatJson(recipeJsonSchema()));
