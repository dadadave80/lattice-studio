/**
 * `public/schema/recipe.v1.json`: core's `recipeJsonSchema()` (C7b), served beside the app so editors can
 * autocomplete a `recipe.json` (RECIPE_SCHEMA_URL points at it once Studio has a domain). The build writes it
 * before bundling; the file is committed, and it changes only when core's schema does.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const RECIPE_SCHEMA_FILE = join("schema", "recipe.v1.json");

export type SchemaWrite =
  | { status: "written" | "unchanged"; file: string }
  | { status: "skipped"; file: string; reason: string };

/** The formatted schema, from `schema-source.ts` run with Bun. Throws with Bun's message when it fails. */
export function schemaFromCore(): string {
  const source = fileURLToPath(new URL("./schema-source.ts", import.meta.url));
  const run = spawnSync("bun", [source], { encoding: "utf8" });
  if (run.error) throw run.error;
  if (run.status !== 0) {
    const lines = run.stderr.trim().split("\n");
    throw new Error(lines.find((l) => /NotImplemented|Not built yet|Error:/.test(l)) ?? lines.at(-1) ?? "bun failed");
  }
  return run.stdout;
}

/** Writes the schema under `publicDir` when it differs; never throws (a stub or a failure is a warning). */
export function writeRecipeSchema(publicDir: string, schema: () => string = schemaFromCore): SchemaWrite {
  const file = join(publicDir, RECIPE_SCHEMA_FILE);
  let text: string;
  try {
    text = schema();
    JSON.parse(text);
  } catch (error) {
    return { status: "skipped", file, reason: error instanceof Error ? error.message : String(error) };
  }
  if (existsSync(file) && readFileSync(file, "utf8") === text) return { status: "unchanged", file };
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
  return { status: "written", file };
}
