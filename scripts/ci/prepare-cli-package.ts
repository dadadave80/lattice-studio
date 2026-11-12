#!/usr/bin/env bun
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function prepareCliPackage(manifest: unknown): Record<string, unknown> {
  if (!isRecord(manifest)) throw new Error("The CLI package manifest must be a JSON object.");
  const prepared = { ...manifest };
  delete prepared.private;
  for (const field of ["dependencies", "devDependencies", "peerDependencies"]) {
    if (manifest[field] === undefined) continue;
    const dependencies = manifest[field];
    if (!isRecord(dependencies)) throw new Error(`The CLI package ${field} must be a JSON object.`);
    const remaining: Record<string, string> = {};
    for (const [name, range] of Object.entries(dependencies)) {
      if (typeof range !== "string") throw new Error(`The CLI dependency ${name} must have a string version range.`);
      if (!range.startsWith("workspace:")) remaining[name] = range;
    }
    prepared[field] = remaining;
  }
  return prepared;
}

if (import.meta.main) {
  try {
    const path = join(import.meta.dir, "..", "..", "packages", "cli", "package.json");
    const manifest: unknown = JSON.parse(readFileSync(path, "utf8"));
    writeFileSync(path, `${JSON.stringify(prepareCliPackage(manifest), null, 2)}\n`);
    console.log("prepare-cli-package · removed private and bundled workspace dependencies from the CLI package manifest.");
  } catch (error) {
    console.error(`prepare-cli-package · ${error instanceof Error ? error.message : "The package manifest could not be prepared."}`);
    process.exitCode = 1;
  }
}
