#!/usr/bin/env bun
// `bun scripts/ci/schema-drift.ts [--write]`: the recipe JSON Schema core generates (C7b's `recipeJsonSchema`)
// against the committed snapshot at scripts/ci/schema/recipe.v1.json, so a schema change is caught here rather
// than surfacing only when `bun run build` writes it to apps/studio/public/schema/. `--write` refreshes the
// snapshot (review the git diff after).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { recipeJsonSchema } from "@lattice-studio/core";
import { diffJson, formatDrift, type JsonValue } from "./schema-drift-logic.ts";

const snapshotPath = join(import.meta.dir, "schema", "recipe.v1.json");

async function main(): Promise<void> {
  const write = process.argv.includes("--write");
  const actual = recipeJsonSchema() as unknown as JsonValue;
  const rendered = `${JSON.stringify(actual, null, 2)}\n`;

  if (write) {
    writeFileSync(snapshotPath, rendered);
    console.log(`schema-drift · wrote ${snapshotPath}`);
    return;
  }

  if (!existsSync(snapshotPath)) {
    console.error(`schema-drift · fail, no snapshot at ${snapshotPath}; run \`bun scripts/ci/schema-drift.ts --write\``);
    process.exit(1);
  }
  const expected = JSON.parse(readFileSync(snapshotPath, "utf8")) as JsonValue;
  const lines = diffJson(expected, actual);
  if (lines.length > 0) {
    console.error(`schema-drift · fail, the recipe JSON Schema drifted from ${snapshotPath}:\n${formatDrift(lines)}`);
    console.error("Run `bun scripts/ci/schema-drift.ts --write` and review the diff.");
    process.exit(1);
  }
  console.log("schema-drift · pass, the recipe JSON Schema matches the committed snapshot.");
}

await main();
