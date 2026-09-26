/**
 * First-load composition (brief Q4): which modules sit in the chunks the page loads first, and how much of the
 * gzip size each accounts for. A production build doesn't record that, so this builds the app a second time,
 * the same config under Node as `bun run build`, into a scratch folder with one extra plugin that only reads the
 * bundle. It then checks the entry chunk's file name against the build of record's (`dist/index.html`): equal
 * names mean equal content, so the composition describes the build `bun scripts/ci/size.ts --build` measured.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { gzipSync } from "node:zlib";
import { expect, test } from "@playwright/test";
import { build, type Plugin } from "vite";
import type { ChunkSize, CompositionResult, ModuleSize } from "../../../../scripts/perf/types.ts";
import { appDir } from "../../local-env.ts";
import { DIST_DIR, perfOut } from "./env.ts";
import { relativeId, saveMap } from "./maps.ts";

type Observed = { file: string; isEntry: boolean; imports: string[]; code: string; modules: { id: string; rendered: number; code: string }[] };

/** Records every JavaScript chunk and its modules as the bundle is written. Changes nothing. */
function observer(into: Observed[]): Plugin {
  return {
    name: "lattice-perf-observer",
    apply: "build",
    generateBundle(_options, bundle) {
      for (const item of Object.values(bundle)) {
        if (item.type !== "chunk") continue;
        into.push({
          file: item.fileName,
          isEntry: item.isEntry,
          imports: [...item.imports],
          code: item.code,
          modules: Object.entries(item.modules).map(([id, m]) => ({ id, rendered: m.renderedLength, code: m.code ?? "" })),
        });
      }
    },
  };
}

/** The module script and modulepreloads an index.html names, as paths relative to the build folder. */
function firstLoadOf(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["']\/?([^"']+)["']/gi)) if (m[1]) out.push(m[1]);
  for (const m of html.matchAll(/<link\b[^>]*\brel=["']modulepreload["'][^>]*\bhref=["']\/?([^"']+)["']/gi)) if (m[1]) out.push(m[1]);
  return out;
}

test("first-load composition", async () => {
  const out = perfOut();
  const outDir = join(out, "composition-dist");
  const mapsDir = join(out, "maps");
  mkdirSync(mapsDir, { recursive: true });
  const observed: Observed[] = [];
  try {
    // Hidden source maps: written beside the chunks without a `sourceMappingURL` comment, so every chunk's code,
    // and so its content-hashed name, is the build of record's. The drag benchmark's CPU profile maps through them.
    await build({
      configFile: join(appDir, "vite.config.ts"),
      logLevel: "warn",
      plugins: [observer(observed)],
      build: { outDir, emptyOutDir: true, sourcemap: "hidden" },
    });
    const html = readFileSync(join(outDir, "index.html"), "utf8");
    const firstLoad = firstLoadOf(html);
    const entry = observed.find((c) => c.isEntry);
    expect(entry, "the build has an entry chunk").toBeDefined();
    const recordHtml = existsSync(join(DIST_DIR, "index.html")) ? readFileSync(join(DIST_DIR, "index.html"), "utf8") : null;
    const recordEntry = recordHtml === null ? null : (firstLoadOf(recordHtml)[0] ?? null);
    const firstSet = new Set(firstLoad);
    const chunks: ChunkSize[] = observed.map((c) => {
      const first = firstSet.has(c.file);
      const modules: ModuleSize[] = first
        ? c.modules.map((m) => ({ id: relativeId(m.id), rendered: m.rendered, gz: m.code ? gzipSync(m.code).byteLength : 0 }))
        : [];
      const map = join(outDir, `${c.file}.map`);
      if (existsSync(map)) {
        const written = readFileSync(join(outDir, c.file), "utf8");
        saveMap(JSON.parse(readFileSync(map, "utf8")), dirname(map), join(mapsDir, `${basename(c.file)}.map`), written);
      }
      return { file: c.file, isEntry: c.isEntry, imports: c.imports, raw: Buffer.byteLength(c.code), gz: gzipSync(c.code).byteLength, modules };
    });
    const unmatched = observed.map((c) => c.file).filter((file) => !existsSync(join(DIST_DIR, file)));
    const result: CompositionResult = { entryFile: entry?.file ?? "", recordEntryFile: recordEntry, firstLoad, unmatched, chunks };
    writeFileSync(join(out, "composition.json"), JSON.stringify(result));
    expect(firstLoad.length).toBeGreaterThan(0);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});
