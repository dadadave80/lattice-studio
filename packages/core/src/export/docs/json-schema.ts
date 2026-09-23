import * as z from "zod";
import type { RecipeJsonSchemaFn } from "../../model/api";
import type { JsonObject } from "../../model/json";
import { RecipeSchema } from "../../model/schema";
import { RECIPE_SCHEMA_URL } from "./schema-url";

/**
 * JSON Schema for `recipe.json` (spec L920-L923: "`$schema` gives editor autocomplete and validation"),
 * generated from the Zod recipe schema so it can't drift. `RecipeSchema` carries no transforms, so
 * `{ io: "input" }` describes exactly what a recipe file must look like (contracts §3.2). Identified by
 * `RECIPE_SCHEMA_URL`; a build's `bun run build` writes the result to `apps/studio/public/schema/recipe.v1.json`.
 */
export const recipeJsonSchema: RecipeJsonSchemaFn = () => {
  const { $schema, ...rest } = z.toJSONSchema(RecipeSchema, { io: "input" }) as unknown as JsonObject;
  const named: JsonObject = { $id: RECIPE_SCHEMA_URL, title: "Lattice Studio recipe", ...rest };
  const ordered: JsonObject = $schema === undefined ? named : { $schema, ...named };
  return JSON.parse(JSON.stringify(ordered)) as JsonObject;
};
