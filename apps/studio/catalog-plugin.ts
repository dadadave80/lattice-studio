/**
 * Serves the catalogs at `/catalog/` in dev and preview and copies them into the build (contracts §4): the
 * generated `catalog/` (CG8) and the fixtures' `fixtures/catalog/` (K3), with one merged `manifest.json`.
 * Either folder may be missing; with neither, `/catalog/manifest.json` is a 404 and the app says so.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import type { Connect, Plugin } from "vite";

type ManifestEntry = { id: string; tag: string; commit: string; hash: string; path: string };
export type Manifest = { default: string; catalogs: ManifestEntry[] };

function readManifest(dir: string): Manifest | null {
  const file = join(dir, "manifest.json");
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8")) as Manifest;
}

/**
 * One manifest from every source, in order: the first source's default wins, and later sources add the
 * catalogs the earlier ones don't list. Null when no source has a manifest.
 */
export function mergedManifest(sources: readonly string[]): Manifest | null {
  let merged: Manifest | null = null;
  for (const dir of sources) {
    const manifest = readManifest(dir);
    if (!manifest) continue;
    if (!merged) {
      merged = { default: manifest.default, catalogs: [...manifest.catalogs] };
      continue;
    }
    const seen = new Set(merged.catalogs.map((c) => c.id));
    for (const entry of manifest.catalogs) if (!seen.has(entry.id)) merged.catalogs.push(entry);
  }
  return merged;
}

const contentTypes: Record<string, string> = {
  ".json": "application/json",
  ".hex": "text/plain; charset=utf-8",
};

function send(res: ServerResponse, type: string, body: string | Buffer): void {
  res.statusCode = 200;
  res.setHeader("Content-Type", type);
  res.setHeader("Cache-Control", "no-cache");
  res.end(body);
}

/** Missing catalog files are 404s, never the SPA fallback's index.html. */
function notFound(res: ServerResponse): void {
  res.statusCode = 404;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end("Not found");
}

/** The `/catalog/` middleware over `sources`, first match wins. */
export function catalogMiddleware(sources: readonly string[]): Connect.NextHandleFunction {
  return (req, res, next) => {
    const url = (req.url ?? "").split("?")[0] ?? "";
    if (!url.startsWith("/catalog/")) return next();
    let rest: string;
    try {
      rest = decodeURIComponent(url.slice("/catalog/".length));
    } catch {
      return notFound(res);
    }
    if (rest === "manifest.json") {
      const manifest = mergedManifest(sources);
      return manifest ? send(res, "application/json", JSON.stringify(manifest)) : notFound(res);
    }
    const relative = normalize(rest);
    if (relative.startsWith("..") || relative.startsWith(sep)) return notFound(res);
    for (const dir of sources) {
      const file = join(dir, relative);
      if (file.startsWith(dir + sep) && existsSync(file)) {
        return send(res, contentTypes[extname(file)] ?? "application/octet-stream", readFileSync(file));
      }
    }
    return notFound(res);
  };
}

export function studioCatalog(sources: readonly string[]): Plugin {
  let outDir = "dist";
  return {
    name: "lattice-studio:catalog",
    configResolved(config) {
      outDir = config.build.outDir;
    },
    configureServer(server) {
      server.middlewares.use(catalogMiddleware(sources));
    },
    configurePreviewServer(server) {
      server.middlewares.use(catalogMiddleware(sources));
    },
    writeBundle() {
      const target = join(outDir, "catalog");
      // Later sources first, so an earlier source wins where both have a file.
      for (const dir of [...sources].reverse()) {
        if (existsSync(dir)) cpSync(dir, target, { recursive: true });
      }
      const manifest = mergedManifest(sources);
      if (manifest) {
        mkdirSync(target, { recursive: true });
        writeFileSync(join(target, "manifest.json"), JSON.stringify(manifest));
      }
    },
  };
}
