import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NotImplemented, recipeJsonSchema } from "@lattice-studio/core";
import { formatJson } from "./headers.ts";
import { RECIPE_SCHEMA_FILE, schemaFromCore, writeRecipeSchema } from "./recipe-schema.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "studio-schema-"));
  dirs.push(dir);
  return dir;
}

describe("writeRecipeSchema", () => {
  test("writes core's schema, then leaves an identical file alone", () => {
    const dir = scratch();
    expect(writeRecipeSchema(dir, () => formatJson({ a: 1 })).status).toBe("written");
    const file = join(dir, RECIPE_SCHEMA_FILE);
    const first = statSync(file).mtimeMs;
    expect(writeRecipeSchema(dir, () => formatJson({ a: 1 })).status).toBe("unchanged");
    expect(statSync(file).mtimeMs).toBe(first);
    expect(writeRecipeSchema(dir, () => formatJson({ a: 2 })).status).toBe("written");
  });

  test("skips with the reason while core's schema is a stub", () => {
    const result = writeRecipeSchema(scratch(), () => {
      throw new NotImplemented("C7b", "recipeJsonSchema");
    });
    expect(result.status).toBe("skipped");
    expect(result.status === "skipped" && result.reason).toContain("C7b");
  });

  test("the schema core prints under Bun is recipeJsonSchema()", () => {
    expect(schemaFromCore()).toBe(formatJson(recipeJsonSchema()));
  });

  test("the committed public/schema/recipe.v1.json is current", () => {
    const committed = readFileSync(join(import.meta.dir, "..", "public", RECIPE_SCHEMA_FILE), "utf8");
    expect(committed).toBe(formatJson(recipeJsonSchema()));
  });
});
