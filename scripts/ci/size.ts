#!/usr/bin/env bun
// `bun scripts/ci/size.ts [--build]`: gzip sizes of the first-load JS, CSS, each lazy chunk, fonts and the
// catalog index against spec L809-L814 (brief Q6). `--build` runs `bun run build` first; the `size` merge gate
// calls it that way. Without `--build`, checks whatever is already in apps/studio/dist/, or says there's nothing
// to check. Exit 1 if a hard budget is over (the catalog index warns only).
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { type BuildFile, classifyBuild, renderReport } from "./size-logic.ts";

const root = join(import.meta.dir, "..", "..");
const appDir = join(root, "apps", "studio");
const distDir = join(appDir, "dist");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

function readManifestDefault(catalogDir: string): string | null {
  const manifestPath = join(catalogDir, "manifest.json");
  if (!existsSync(manifestPath)) return null;
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { default?: string; catalogs?: { id: string; path: string }[] };
    const entry = manifest.catalogs?.find((c) => c.id === manifest.default);
    return entry ? join(catalogDir, entry.path) : null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const build = process.argv.includes("--build");

  if (build) {
    console.log("size · running `bun run build`…");
    const p = Bun.spawnSync(["bun", "run", "build"], { cwd: root, stdout: "inherit", stderr: "inherit" });
    if (p.exitCode !== 0) {
      console.error("size · `bun run build` failed; see above.");
      process.exit(1);
    }
  }

  if (!existsSync(distDir)) {
    console.log(`size · no build at ${relative(root, distDir)}; run \`bun scripts/ci/size.ts --build\` for a full check. Skipping.`);
    process.exit(0);
  }
  if (!build) {
    console.log(`size · using the existing build at ${relative(root, distDir)} (pass --build to rebuild first; it may be stale).`);
  }

  const indexHtmlPath = join(distDir, "index.html");
  if (!existsSync(indexHtmlPath)) {
    console.error(`size · ${relative(root, indexHtmlPath)} is missing; the build didn't produce an entry page.`);
    process.exit(1);
  }
  const indexHtml = readFileSync(indexHtmlPath, "utf8");

  const catalogDir = join(distDir, "catalog");
  const catalogIndexPath = existsSync(catalogDir) ? readManifestDefault(catalogDir) : null;
  const catalogIndex: BuildFile | null =
    catalogIndexPath && existsSync(catalogIndexPath)
      ? { path: relative(distDir, catalogIndexPath), bytes: new Uint8Array(readFileSync(catalogIndexPath)) }
      : null;

  const files: BuildFile[] = [];
  for (const abs of walk(distDir)) {
    const path = relative(distDir, abs);
    if (path === "index.html") continue;
    if (path.startsWith("catalog/")) continue; // the catalog isn't a bundle asset; measured separately above
    files.push({ path, bytes: new Uint8Array(readFileSync(abs)) });
  }

  const report = classifyBuild({ indexHtml, files, catalogIndex, gzip: (b) => Bun.gzipSync(b) });
  console.log(renderReport(report));
  process.exit(report.ok ? 0 : 1);
}

await main();
