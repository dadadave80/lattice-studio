import type { MigrateFn } from "../model/api";
import type { Migrated } from "../model/io";
import type { Json, JsonObject } from "../model/json";
import { RECIPE_SCHEMA_VERSION } from "../model/recipe";
import { err, ok, type Result } from "../model/result";
import { formatPath } from "../model/path";
import { findProtoKey } from "./proto-key";

/**
 * One forward step: takes a recipe at schema version `n` (its registry key) and returns it at `n + 1`.
 * The runner sets `schemaVersion` afterwards, so a step only moves fields. Steps must be pure.
 */
export type MigrationStep = (recipe: JsonObject) => JsonObject;

/**
 * Forward steps keyed by the version they migrate from (spec L289, L923). v1 is current, so there are none
 * yet; a breaking change bumps `RECIPE_SCHEMA_VERSION` and adds its step here: `new Map([[1, v1ToV2]])`.
 */
export const MIGRATIONS: ReadonlyMap<number, MigrationStep> = new Map();

/** Where the recipe sits: a recipe, a project (`.recipe`) or a project file (`.project.recipe`). */
export type MigrateTarget = "recipe" | "project" | "projectFile";

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

type Located = { recipe: JsonObject; put: (recipe: JsonObject) => Json };

function locate(json: unknown, target: MigrateTarget): Located | null {
  if (!isObject(json)) return null;
  if (target === "recipe") return { recipe: json, put: (recipe) => recipe };
  if (target === "project") {
    const recipe = json["recipe"];
    return isObject(recipe) ? { recipe, put: (next) => ({ ...json, recipe: next }) } : null;
  }
  const project = json["project"];
  const recipe = isObject(project) ? project["recipe"] : undefined;
  if (!isObject(project) || !isObject(recipe)) return null;
  return { recipe, put: (next) => ({ ...json, project: { ...project, recipe: next } }) };
}

/** Which document `json` is, by where it keeps `schemaVersion`. */
export function detectDocument(json: unknown): MigrateTarget {
  if (isObject(json) && Object.hasOwn(json, "schemaVersion")) return "recipe";
  if (isObject(json) && isObject(json["recipe"])) return "project";
  if (isObject(json) && isObject(json["project"])) return "projectFile";
  return "recipe";
}

/**
 * The migration runner, with the registry and current version injectable for tests. Anything it can't place
 * (not an object, no recipe, a `schemaVersion` that isn't a whole number, an older version with no step)
 * comes back unchanged with `from === to`, and validation then says what's wrong with it.
 */
export function runMigrations(
  json: unknown,
  target: MigrateTarget,
  steps: ReadonlyMap<number, MigrationStep> = MIGRATIONS,
  current: number = RECIPE_SCHEMA_VERSION,
): Result<Migrated, string> {
  const located = locate(json, target);
  const version = located?.recipe["schemaVersion"];
  const unchanged = (at: number): Result<Migrated, string> => ok({ value: json as Json, from: at, to: at });
  if (located === null || typeof version !== "number" || !Number.isInteger(version)) return unchanged(current);
  if (version > current) return err(`This file needs Studio schema v${version}. This Studio reads v${current}.`);
  let recipe = located.recipe;
  for (let at = version; at < current; at++) {
    const step = steps.get(at);
    if (step === undefined) return unchanged(version);
    recipe = { ...step(recipe), schemaVersion: at + 1 };
  }
  if (version === current) return unchanged(current);
  return ok({ value: located.put(recipe), from: version, to: current });
}

/**
 * Forward-only migrations keyed by `schemaVersion` (spec L289). Takes a recipe, a project or a project file.
 * A newer version fails with "This file needs Studio schema v2. This Studio reads v1." A `"__proto__"` key
 * anywhere is refused first, with its path, since a step's copies could drop it or turn it into a prototype.
 */
export const migrate: MigrateFn = (json) => {
  const protoPath = findProtoKey(json);
  if (protoPath !== null) return err(`This file has a reserved field name at ${formatPath(protoPath)}. Remove the field and try again.`);
  return runMigrations(json, detectDocument(json));
};
