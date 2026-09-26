/**
 * The analysis benchmark (spec L301, L817; brief Q4): `analyze` on 30 facets inside Chromium with the CPU
 * throttled 4×, against the catalog the app ships. Core is bundled on its own with Vite (Rolldown and the same
 * minifier as production) and run on `about:blank`, where no CSP stands in the way of the injected script. Two
 * recipes: the 30 colliding cards the drag benchmark draws (SEL-01 blockers throughout), and the first 30 facets
 * outside a family (core's own unthrottled bench in `analyze.test.ts`). A profiled pass of the first follows,
 * so a miss names the checks the time goes to.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { build } from "vite";
import type { Recipe } from "@lattice-studio/core";
import { makeRecipe } from "@lattice-studio/core/testing";
import { summarize } from "../../../../scripts/perf/stats.ts";
import type { AnalysisCase, AnalysisResult, Profile } from "../../../../scripts/perf/types.ts";
import { catalog } from "../../e2e/_support/catalog.ts";
import { collisionsProject } from "../../e2e/_support/projects.ts";
import type { BenchOutput } from "./analysis-entry.ts";
import { CPU_THROTTLE, perfOut, smoke } from "./env.ts";
import { saveMap } from "./maps.ts";
import { profile, throttled } from "./page.ts";

const RUNS = smoke() ? 8 : 60;
const WARMUP = smoke() ? 2 : 10;

/** The name the bundle runs under in the page, and its source map's in the results. */
const SCRIPT_NAME = "perf-analysis.js";

/**
 * `analysis-entry.ts` as one minified script, named `SCRIPT_NAME` for the profiler, its source map saved into
 * `maps` so run.ts can name the modules a profile's time goes to.
 */
async function bundle(maps: string): Promise<string> {
  const output = await build({
    configFile: false,
    logLevel: "warn",
    build: {
      write: false,
      minify: true,
      sourcemap: "hidden",
      lib: { entry: join(import.meta.dirname, "analysis-entry.ts"), formats: ["iife"], name: "latticePerf" },
    },
  });
  for (const out of Array.isArray(output) ? output : [output]) {
    if (!("output" in out)) continue;
    for (const item of out.output) {
      if (item.type !== "chunk") continue;
      mkdirSync(maps, { recursive: true });
      // Unwritten, the map's sources are relative to where the chunk would have gone: `dist/` under the root.
      if (item.map) saveMap(item.map, join(process.cwd(), "dist"), join(maps, `${SCRIPT_NAME}.map`));
      return `${item.code}\n//# sourceURL=${SCRIPT_NAME}`;
    }
  }
  throw new Error("Vite produced no script for the analysis benchmark.");
}

test("analysis on 30 facets", async ({ page }) => {
  const shipped = catalog();
  const plain = shipped.facets.filter((f) => f.family === undefined).slice(0, 30).map((f) => f.name);
  expect(plain).toHaveLength(30);
  const recipes: [string, Recipe][] = [
    ["30 colliding cards", collisionsProject().recipe],
    ["30 facets outside a family", makeRecipe({ facets: plain }, shipped)],
  ];

  const code = await bundle(join(perfOut(), "maps"));
  await page.goto("about:blank");
  await page.addScriptTag({ content: code });
  const cdp = await throttled(page);
  type Bench = { prepareCatalogs: (c: unknown, n: number) => void; benchAnalyze: (r: unknown, runs: number, warmup: number) => BenchOutput };
  // The catalog crosses into the page once; each run's copies are made there before it starts.
  await page.evaluate(
    (catalog) => {
      (globalThis as unknown as { perfCatalog: unknown }).perfCatalog = catalog;
    },
    JSON.parse(JSON.stringify(shipped)) as unknown,
  );
  const prepare = (count: number): Promise<void> =>
    page.evaluate((n) => {
      const g = globalThis as unknown as Bench & { perfCatalog: unknown };
      g.prepareCatalogs(g.perfCatalog, n);
    }, count);
  const run = (recipe: Recipe, runs: number, warmup: number): Promise<BenchOutput> =>
    page.evaluate(
      (args) => (globalThis as unknown as Bench).benchAnalyze(args.recipe, args.runs, args.warmup),
      { recipe: JSON.parse(JSON.stringify(recipe)) as unknown, runs, warmup },
    );

  const cases: AnalysisCase[] = [];
  for (const [name, recipe] of recipes) {
    await prepare(RUNS + WARMUP);
    const out = await run(recipe, RUNS, WARMUP);
    cases.push({ name, facets: out.facets, exported: out.exported, problems: out.problems, stats: summarize(out.times) });
  }
  const first = recipes[0]?.[1];
  const profiles: Profile[] = [];
  if (first) {
    await prepare(RUNS);
    profiles.push(await profile(cdp, "analysis", async () => void (await run(first, RUNS, 0))));
  }
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });

  const result: AnalysisResult = { throttle: CPU_THROTTLE, cases, profiles };
  mkdirSync(perfOut(), { recursive: true });
  writeFileSync(join(perfOut(), "analysis.json"), JSON.stringify(result, null, 2));
  for (const c of cases) {
    console.log(
      `analysis · ${c.name} · ${c.facets} facets, ${c.exported} selectors, ${c.problems} problems · ` +
        `median ${c.stats.median.toFixed(2)} ms, p95 ${c.stats.p95.toFixed(2)} ms over ${c.stats.n} runs at ${CPU_THROTTLE}×`,
    );
    expect(c.facets).toBe(30);
    expect(c.stats.n).toBe(RUNS);
  }
});
