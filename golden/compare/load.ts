// Loads what the golden comparison needs: the real catalog's v1 templates, each loaded as a recipe the way the
// app loads it, and golden/expected/<Recipe>.routing.json for each. Says why when there's nothing to compare.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { loadTemplate, templateList, type Catalog, type Recipe, type RecipeTemplate, type Result } from "@lattice-studio/core";
import { parseRoutingFile } from "../lib/diff.ts";
import type { RoutingFile } from "../lib/report.ts";

export const REPO_ROOT = join(import.meta.dir, "..", "..");
export const EXPECTED_DIR = join(REPO_ROOT, "golden", "expected");
const SUFFIX = ".routing.json";

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
  | { ready: false; skip: string };

/** Pairs every loadable (v1) template in `catalog` with its expected file in `dir`. */
export function loadGolden(catalog: Result<Catalog, string>, dir: string = EXPECTED_DIR): GoldenSetup {
  if (!catalog.ok) return { ready: false, skip: `the real catalog isn't built (${catalog.error}). Run bun run catalog.` };
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(SUFFIX)).sort() : [];
  if (files.length === 0) {
    return { ready: false, skip: `${relative(REPO_ROOT, dir) || dir} has no *${SUFFIX} files. Run bun run golden --update to record them.` };
  }

  const problems: string[] = [];
  const cases: GoldenCase[] = [];
  const v1 = templateList(catalog.value).filter((item) => item.loadable).map((item) => item.name);
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
    const template = catalog.value.recipes.find((candidate) => candidate.name === name);
    const recipe = loadTemplate(catalog.value, name);
    if (template === undefined || !recipe.ok) {
      problems.push(`${name} doesn't load: ${recipe.ok ? "no such template" : recipe.error}`);
      continue;
    }
    cases.push({ name, template, recipe: recipe.value, expected: parsed.value, path: rel });
  }
  for (const file of files) {
    const name = file.slice(0, -SUFFIX.length);
    if (!v1.includes(name)) problems.push(`${relative(REPO_ROOT, join(dir, file))} names ${name}, which isn't a v1 recipe in catalog ${catalog.value.lattice.tag}.`);
  }
  return { ready: true, catalog: catalog.value, cases, problems };
}
