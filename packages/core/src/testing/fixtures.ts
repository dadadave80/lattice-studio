/**
 * Fixture catalog loaders for tests (`fixtures/catalog/<id>/`, written by K3). They return `Result`, so a test
 * can skip cleanly while a fixture doesn't exist yet:
 *
 *   const fixture = loadFixtureCatalog();
 *   test.skipIf(!fixture.ok)("…", () => { … });
 *
 * They read the file system through `process.getBuiltinModule`, so importing this module in a browser bundle
 * is harmless: the loaders just return an error there.
 */
import type { Catalog, FacetDetail } from "../model/catalog";
import type { ParseIssue } from "../model/io";
import { err, ok, type Result } from "../model/result";
import { validateCatalog, validateFacetDetail } from "../model/schema";

const FIXTURES = new URL("../../../../fixtures/catalog/", import.meta.url);

type FsLike = { readFileSync(path: URL, encoding: "utf8"): string; existsSync(path: URL): boolean };

function fileSystem(): FsLike | null {
  const proc: unknown = (globalThis as { process?: unknown }).process;
  if (proc === undefined || proc === null || typeof proc !== "object" || !("getBuiltinModule" in proc)) return null;
  const load = (proc as { getBuiltinModule: (id: string) => unknown }).getBuiltinModule;
  const fs = load("node:fs") as FsLike | undefined;
  return fs ?? null;
}

function readJson(url: URL): Result<unknown, string> {
  const fs = fileSystem();
  if (!fs) return err("No file system here: fixture catalogs load only under Bun or Node.");
  if (!fs.existsSync(url)) return err(`${url.pathname} doesn't exist yet (WP-K3 writes the fixture catalogs).`);
  try {
    return ok(JSON.parse(fs.readFileSync(url, "utf8")));
  } catch (error) {
    return err(`${url.pathname} isn't valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function describeIssues(file: string, issues: readonly ParseIssue[]): string {
  return issues.map((issue) => `${file}: ${issue.path || "(root)"} ${issue.message}`).join("\n");
}

/** The fixture catalog's index (`fixtures/catalog/<id>/index.json`), validated. */
export function loadFixtureCatalog(id = "fixture"): Result<Catalog, string> {
  const url = new URL(`${id}/index.json`, FIXTURES);
  const json = readJson(url);
  if (!json.ok) return json;
  const catalog = validateCatalog(json.value);
  return catalog.ok ? catalog : err(describeIssues(`${id}/index.json`, catalog.error));
}

/** One facet shard of a fixture catalog (`fixtures/catalog/<id>/shards/<name>.json`), validated. */
export function loadFixtureShard(name: string, id = "fixture"): Result<FacetDetail, string> {
  const url = new URL(`${id}/shards/${name}.json`, FIXTURES);
  const json = readJson(url);
  if (!json.ok) return json;
  const detail = validateFacetDetail(json.value);
  return detail.ok ? detail : err(describeIssues(`${id}/shards/${name}.json`, detail.error));
}
