/**
 * The analysis benchmark's browser bundle (brief Q4; spec L301 "under 5 ms for 30 facets on a 4× throttled CPU"):
 * core's `analyze`, bundled on its own and timed inside a throttled Chromium page. `analyze` memoizes per catalog
 * object on the recipe hash, so every timed run gets its own structural copy of the catalog, made beforehand by
 * `prepareCatalogs`: each run is a memo miss, as an edit that changes the recipe is, and the copying stays out of
 * both the clock and the profile.
 */
import { analyze, type Catalog, type Recipe } from "@lattice-studio/core";

export type BenchOutput = { times: number[]; exported: number; problems: number; facets: number };

let copies: Catalog[] = [];
let original: Catalog | null = null;

/** Makes `count` structural copies of `catalog` for the next `benchAnalyze`. */
export function prepareCatalogs(catalog: Catalog, count: number): void {
  original = catalog;
  copies = Array.from({ length: count }, () => structuredClone(catalog));
}

/** Times `runs` analyses of `recipe` after `warmup` untimed ones, each on one of the prepared copies. */
export function benchAnalyze(recipe: Recipe, runs: number, warmup: number): BenchOutput {
  if (original === null || copies.length < runs + warmup) throw new Error(`Prepare ${runs + warmup} catalogs first.`);
  const use = copies.splice(0, runs + warmup);
  for (const copy of use.slice(0, warmup)) analyze(recipe, copy);
  const times: number[] = [];
  for (const copy of use.slice(warmup)) {
    const start = performance.now();
    analyze(recipe, copy);
    times.push(performance.now() - start);
  }
  const result = analyze(recipe, original);
  return { times, exported: result.stats.exported, problems: result.problems.length, facets: result.stats.facets };
}

Object.assign(globalThis, { prepareCatalogs, benchAnalyze });
