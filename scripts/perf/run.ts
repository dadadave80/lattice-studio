#!/usr/bin/env bun
// `bun scripts/perf/run.ts [--smoke] [--no-build]`: every performance budget in spec L805-L817 on a production build
// and a 4×-throttled Chromium, from one command (brief Q4).
//
//   1. Size: `bun scripts/ci/size.ts --build` writes the build of record to apps/studio/dist and checks it; the
//      same classification (scripts/ci/size-logic.ts) feeds the table here.
//   2. `vite preview` of that build on this worktree's STUDIO_PORT.
//   3. Lighthouse CI (`lhci collect`, mobile profile, simulated throttling) against the preview: LCP ≤ 2.5 s.
//   4. Playwright (apps/studio/test/perf): the first-load composition, the analysis benchmark (30 facets ≤ 5 ms)
//      and the drag benchmark (30 cards; per-move cost and scripted INP ≤ 200 ms).
//   5. The results table, a fix request per miss, and where each profiled phase's time goes. Results go to
//      apps/studio/test-results/perf-<port>/results.json (gitignored).
//
// `--smoke`: one short pass of each (1 Lighthouse run, 24 moves, 8 analyses), checking the harness works; budgets
// are reported, not enforced. It's the `perf` merge gate. `--no-build`: reuse apps/studio/dist (while iterating).
// Exit 1 when a step fails, or, without --smoke, when an enforced budget is missed.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { localPort } from "../../apps/studio/local-env.ts";
import { classifyBuild, notPrecachedOf, parseIndexHtml, type BuildFile, type SizeReport } from "../ci/size-logic.ts";
import { compose, type Composition } from "./composition.ts";
import { summarizeLighthouse, type Lhr } from "./lighthouse.ts";
import { attribute, type Attribution } from "./profile.ts";
import { evaluate, renderEvaluation } from "./report.ts";
import { decodeMap, type DecodedMap, type RawSourceMap } from "./sourcemap.ts";
import type { AnalysisResult, CompositionResult, DragResult, LighthouseResult } from "./types.ts";

const root = join(import.meta.dir, "..", "..");
const appDir = join(root, "apps", "studio");
const distDir = join(appDir, "dist");
const smoke = process.argv.includes("--smoke");
const noBuild = process.argv.includes("--no-build");
const port = localPort("STUDIO_PORT");
const out = join(appDir, "test-results", `perf-${port}`);
const failures: string[] = [];

function log(message: string): void {
  console.log(`perf · ${message}`);
}

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) files.push(...walk(p));
    else files.push(p);
  }
  return files;
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return null;
  }
}

/** Step 1: the build of record and its size report (what size.ts prints, classified the same way). */
function sizeStep(): { report: SizeReport; recordGz: Map<string, number> } | null {
  if (!noBuild) {
    log("building with `bun scripts/ci/size.ts --build` (log: size.log)");
    const p = Bun.spawnSync(["bun", "scripts/ci/size.ts", "--build"], { cwd: root, stdout: "pipe", stderr: "pipe" });
    writeFileSync(join(out, "size.log"), `${p.stdout.toString()}\n${p.stderr.toString()}`);
    if (!existsSync(join(distDir, "index.html"))) {
      failures.push("The production build failed; see size.log.");
      return null;
    }
    if (p.exitCode !== 0) log("size.ts reports a budget over; see the table below.");
  } else if (!existsSync(join(distDir, "index.html"))) {
    failures.push("--no-build, but there's no build at apps/studio/dist.");
    return null;
  }
  const indexHtml = readFileSync(join(distDir, "index.html"), "utf8");
  const files: BuildFile[] = [];
  for (const abs of walk(distDir)) {
    const path = relative(distDir, abs);
    if (path === "index.html" || path.startsWith("catalog/")) continue;
    files.push({ path, bytes: new Uint8Array(readFileSync(abs)) });
  }
  const manifest = readJson<{ default?: string; catalogs?: { id: string; path: string }[] }>(join(distDir, "catalog", "manifest.json"));
  const entry = manifest?.catalogs?.find((c) => c.id === manifest.default);
  const indexPath = entry ? join(distDir, "catalog", entry.path) : null;
  const catalogIndex = indexPath && existsSync(indexPath) ? { path: relative(distDir, indexPath), bytes: new Uint8Array(readFileSync(indexPath)) } : null;
  const release = join(distDir, "release.json");
  const notPrecached = existsSync(release) ? notPrecachedOf(readFileSync(release, "utf8")) : [];
  const report = classifyBuild({ indexHtml, files, catalogIndex, gzip: (b) => Bun.gzipSync(b), notPrecached });
  const { entryScripts, modulePreloads } = parseIndexHtml(indexHtml);
  const recordGz = new Map<string, number>();
  for (const href of [...entryScripts, ...modulePreloads]) {
    const path = href.replace(/^\//, "");
    const file = files.find((f) => f.path === path);
    if (file) recordGz.set(path, Bun.gzipSync(file.bytes).byteLength);
  }
  return { report, recordGz };
}

/** Step 2: `vite preview` of dist on STUDIO_PORT, ready when `/` answers. */
async function startPreview(): Promise<Bun.Subprocess> {
  const vite = join(root, "node_modules", ".bin", "vite");
  const server = Bun.spawn([vite, "preview", "--host", "localhost"], {
    cwd: appDir,
    env: { ...process.env, STUDIO_PORT: String(port) },
    stdout: "pipe",
    stderr: "pipe",
  });
  const url = `http://localhost:${port}/`;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`vite preview exited (${server.exitCode}): is port ${port} taken?`);
    try {
      const res = await fetch(url);
      if (res.ok) return server;
    } catch {
      // Not listening yet.
    }
    await Bun.sleep(250);
  }
  server.kill();
  throw new Error(`vite preview didn't answer on ${url} within 60 s.`);
}

/** Step 3: Lighthouse CI's collect against the preview, with Playwright's Chromium. */
async function lighthouseStep(): Promise<LighthouseResult | null> {
  const dir = join(out, "lighthouse");
  mkdirSync(dir, { recursive: true });
  const { chromium } = await import("playwright");
  const chromePath = chromium.executablePath();
  if (!existsSync(chromePath)) {
    failures.push(`Lighthouse needs Chromium at ${chromePath}: run \`bun x playwright install chromium\`.`);
    return null;
  }
  const runs = smoke ? 1 : 3;
  // Mobile is Lighthouse's default profile (412 px, simulated slow 4G, 4× CPU); its `preset` has no "mobile".
  const rc = {
    ci: {
      collect: {
        url: [`http://localhost:${port}/`],
        numberOfRuns: runs,
        settings: { onlyCategories: ["performance"], chromeFlags: process.env.CI ? "--headless=new --no-sandbox" : "--headless=new" },
      },
    },
  };
  writeFileSync(join(dir, "lighthouserc.json"), JSON.stringify(rc, null, 2));
  log(`Lighthouse CI, ${runs} run${runs === 1 ? "" : "s"}, mobile profile (log: lighthouse/lhci.log)`);
  const lhci = join(root, "node_modules", ".bin", "lhci");
  const p = Bun.spawnSync([lhci, "collect", "--config=lighthouserc.json"], {
    cwd: dir,
    env: { ...process.env, CHROME_PATH: chromePath },
    stdout: "pipe",
    stderr: "pipe",
  });
  writeFileSync(join(dir, "lhci.log"), `${p.stdout.toString()}\n${p.stderr.toString()}`);
  const reports = join(dir, ".lighthouseci");
  const lhrs = existsSync(reports)
    ? readdirSync(reports).filter((f) => /^lhr-.*\.json$/.test(f)).sort().map((f) => readJson<Lhr>(join(reports, f))).filter((r): r is Lhr => r !== null)
    : [];
  if (p.exitCode !== 0 || lhrs.length === 0) {
    failures.push(`Lighthouse CI failed (exit ${p.exitCode}); see ${relative(root, join(dir, "lhci.log"))}.`);
    return null;
  }
  return summarizeLighthouse(lhrs);
}

/** Step 4: the Playwright benchmarks. */
function playwrightStep(): void {
  log(`Playwright benchmarks${smoke ? " (smoke)" : ""}: composition, analysis, drag`);
  const p = Bun.spawnSync(["bun", "x", "playwright", "test", "-c", "test/perf/playwright.perf.config.ts"], {
    cwd: appDir,
    env: { ...process.env, STUDIO_PORT: String(port), PERF_OUT: out, PERF_SMOKE: smoke ? "1" : "0" },
    stdout: "inherit",
    stderr: "inherit",
  });
  if (p.exitCode !== 0) failures.push(`A Playwright benchmark failed (exit ${p.exitCode}); see above.`);
}

/** Loads a saved source map by script name, once. */
function mapLoader(): (script: string) => DecodedMap | null {
  const cache = new Map<string, DecodedMap | null>();
  return (script) => {
    if (!cache.has(script)) {
      const raw = readJson<RawSourceMap>(join(out, "maps", `${script}.map`));
      cache.set(script, raw ? decodeMap(raw) : null);
    }
    return cache.get(script) ?? null;
  };
}

async function main(): Promise<number> {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const started = Date.now();
  const size = sizeStep();
  let lighthouse: LighthouseResult | null = null;
  if (size) {
    let server: Bun.Subprocess | null = null;
    try {
      server = await startPreview();
      log(`serving apps/studio/dist on http://localhost:${port}/`);
      lighthouse = await lighthouseStep();
      playwrightStep();
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    } finally {
      server?.kill();
      await server?.exited;
    }
  }

  const compositionRaw = readJson<CompositionResult>(join(out, "composition.json"));
  const composition: Composition | null = compositionRaw ? compose(compositionRaw, size?.recordGz) : null;
  const drag = readJson<DragResult>(join(out, "drag.json"));
  const analysis = readJson<AnalysisResult>(join(out, "analysis.json"));
  const maps = mapLoader();
  const profiles: Attribution[] = [...(drag?.profiles ?? []), ...(analysis?.profiles ?? [])].map((p) => attribute(p, maps));
  const evaluation = evaluate({ smoke, size: size?.report ?? null, composition, lighthouse, drag, analysis, profiles });

  console.log("");
  console.log(renderEvaluation(evaluation, profiles, smoke));
  writeFileSync(
    join(out, "results.json"),
    JSON.stringify({ smoke, port, seconds: (Date.now() - started) / 1000, evaluation, composition, lighthouse, profiles, failures }, null, 2),
  );
  console.log("");
  for (const f of failures) console.error(`perf · ${f}`);
  const seconds = ((Date.now() - started) / 1000).toFixed(0);
  if (failures.length > 0) {
    console.error(`perf · ${failures.length} step${failures.length === 1 ? "" : "s"} failed in ${seconds} s. Results so far: ${relative(root, join(out, "results.json"))}.`);
    return 1;
  }
  if (smoke) {
    log(`smoke pass done in ${seconds} s: every benchmark ran; budgets reported, not enforced. Results: ${relative(root, join(out, "results.json"))}.`);
    return 0;
  }
  const missed = evaluation.rows.filter((r) => r.enforced && r.status !== "ok");
  const waiting = evaluation.rows.filter((r) => r.until !== undefined && r.status !== "ok");
  if (waiting.length > 0) {
    log(`report-only until their fix packages land: ${waiting.map((r) => `${r.item.trim()} (${r.until})`).join("; ")}.`);
  }
  log(
    missed.length === 0
      ? `every enforced budget met in ${seconds} s. Results: ${relative(root, join(out, "results.json"))}.`
      : `${missed.length} enforced budget${missed.length === 1 ? "" : "s"} missed (${missed.map((r) => r.item.trim()).join("; ")}) in ${seconds} s; fix requests above.`,
  );
  return missed.length === 0 ? 0 : 1;
}

process.exit(await main());
