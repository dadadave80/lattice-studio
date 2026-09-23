// Loads what the golden comparison needs: the real catalog's v1 templates, each loaded as a recipe the way the
// app loads it, and golden/expected/<Recipe>.routing.json for each. Skips, saying why, only while there's
// nothing to compare (no catalog/manifest.json, no expected files); a catalog that's there but broken fails.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import {
  loadTemplate,
  templateList,
  validateCatalog,
  validateCatalogManifest,
  type Catalog,
  type Recipe,
  type RecipeTemplate,
} from "@lattice-studio/core";
import { parseRoutingFile } from "../lib/diff.ts";
import type { RoutingFile } from "../lib/report.ts";

export const REPO_ROOT = join(import.meta.dir, "..", "..");
export const CATALOG_DIR = join(REPO_ROOT, "catalog");
export const EXPECTED_DIR = join(REPO_ROOT, "golden", "expected");
const SUFFIX = ".routing.json";

/** The real catalog: not built (no manifest), present but unreadable or invalid, or loaded. */
export type CatalogState =
  | { state: "missing"; reason: string }
  | { state: "broken"; error: string }
  | { state: "ok"; catalog: Catalog };

/** One v1 recipe with its expected file. */
export type GoldenCase = {
  name: string;
  template: RecipeTemplate;
  /** The template as `loadTemplate` gives it to the app. */
  recipe: Recipe;
  expected: RoutingFile;
  /** The expected file, relative to the repo root. */
  path: string;
};

export type GoldenSetup =
  /** `problems`: v1 recipes and expected files that don't pair up or don't load. Each one fails the suite. */
  | { ready: true; catalog: Catalog; cases: GoldenCase[]; problems: string[] }
  /** Nothing to compare yet: the reason the suite skips. */
  | { ready: false; skip: string }
  /** The catalog is there but doesn't load: the suite fails. */
  | { ready: false; error: string };

/**
 * Reads `<dir>/manifest.json`'s default catalog and validates it. Only a missing manifest counts as "not built";
 * `catalog/` is tracked, so anything else that goes wrong means the committed catalog is broken.
 */
export function readCatalog(dir: string = CATALOG_DIR): CatalogState {
  const manifestPath = join(dir, "manifest.json");
  const rel = (path: string): string => relative(REPO_ROOT, path) || path;
  if (!existsSync(manifestPath)) return { state: "missing", reason: `${rel(manifestPath)} doesn't exist. Run bun run catalog.` };
  const manifestJson = readJson(manifestPath);
  if (!manifestJson.ok) return { state: "broken", error: `${rel(manifestPath)} ${manifestJson.error}` };
  const manifest = validateCatalogManifest(manifestJson.value);
  if (!manifest.ok) return { state: "broken", error: `${rel(manifestPath)}: ${issues(manifest.error)}` };
  const entry = manifest.value.catalogs.find((candidate) => candidate.id === manifest.value.default);
  if (entry === undefined) return { state: "broken", error: `${rel(manifestPath)} lists no catalog with the default id ${manifest.value.default}.` };
  const indexPath = join(dir, entry.path);
  if (!existsSync(indexPath)) return { state: "broken", error: `${rel(indexPath)} doesn't exist, though ${rel(manifestPath)} names it.` };
  const indexJson = readJson(indexPath);
  if (!indexJson.ok) return { state: "broken", error: `${rel(indexPath)} ${indexJson.error}` };
  const catalog = validateCatalog(indexJson.value);
  if (!catalog.ok) return { state: "broken", error: `${rel(indexPath)}: ${issues(catalog.error)}` };
  return { state: "ok", catalog: catalog.value };
}

/** Pairs every loadable (v1) template in the catalog with its expected file in `dir`. */
export function loadGolden(catalog: CatalogState, dir: string = EXPECTED_DIR): GoldenSetup {
  if (catalog.state === "missing") return { ready: false, skip: `the real catalog isn't built: ${catalog.reason}` };
  if (catalog.state === "broken") return { ready: false, error: `the real catalog doesn't load: ${catalog.error}` };
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(SUFFIX)).sort() : [];
  if (files.length === 0) {
    return { ready: false, skip: `${relative(REPO_ROOT, dir) || dir} has no *${SUFFIX} files. Run bun run golden --update to record them.` };
  }

  const problems: string[] = [];
  const cases: GoldenCase[] = [];
  const v1 = templateList(catalog.catalog).filter((item) => item.loadable).map((item) => item.name);
  for (const name of v1) {
    const path = join(dir, `${name}${SUFFIX}`);
    const rel = relative(REPO_ROOT, path);
    if (!files.includes(`${name}${SUFFIX}`)) {
      problems.push(`${name} is a v1 recipe but ${rel} doesn't exist: add it to golden/harness and run bun run golden --update.`);
      continue;
    }
    const parsed = parseRoutingFile(readFileSync(path, "utf8"));
    if (!parsed.ok) {
      problems.push(`${rel} ${parsed.error}.`);
      continue;
    }
    const template = catalog.catalog.recipes.find((candidate) => candidate.name === name);
    const recipe = loadTemplate(catalog.catalog, name);
    if (template === undefined || !recipe.ok) {
      problems.push(`${name} doesn't load: ${recipe.ok ? "no such template" : recipe.error}`);
      continue;
    }
    cases.push({ name, template, recipe: recipe.value, expected: parsed.value, path: rel });
  }
  for (const file of files) {
    const name = file.slice(0, -SUFFIX.length);
    if (!v1.includes(name)) problems.push(`${relative(REPO_ROOT, join(dir, file))} names ${name}, which isn't a v1 recipe in catalog ${catalog.catalog.lattice.tag}.`);
  }
  return { ready: true, catalog: catalog.catalog, cases, problems };
}

function readJson(path: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(readFileSync(path, "utf8")) };
  } catch (e) {
    return { ok: false, error: `isn't valid JSON (${e instanceof Error ? e.message : String(e)})` };
  }
}

function issues(list: readonly { path: string; message: string }[]): string {
  const shown = list.slice(0, 5).map((issue) => `${issue.path || "(root)"} ${issue.message}`);
  return list.length > 5 ? `${shown.join("; ")}; and ${list.length - 5} more` : shown.join("; ");
}
