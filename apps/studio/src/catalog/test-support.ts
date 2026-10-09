/**
 * For tests of the catalog's lazy parts (Q15): an inline catalog (the fixture) turned into one that keeps its
 * recipes and init docs in `recipes.json` and `init-docs.json`, as `bun run catalog` writes the real one, and a
 * fetch that serves those two files.
 */
import type { Catalog, ShardRef } from "@lattice-studio/core";
import { splitInitDocs, splitRecipes } from "@lattice-studio/core";
import { keccak256 } from "viem";

export type ShardedCatalog = { catalog: Catalog; files: Map<string, Uint8Array> };

/** `inline` without recipes and init docs, which move to `files` and are referenced by `catalog.shards`. */
export function shardedCatalog(inline: Catalog): ShardedCatalog {
  const files = new Map<string, Uint8Array>();
  const put = (path: string, value: unknown): ShardRef => {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    files.set(path, bytes);
    return { path, bytes: bytes.length, hash: keccak256(bytes) };
  };
  const recipes = splitRecipes(inline.recipes);
  const docs = splitInitDocs(inline.inits);
  const shards = { recipes: put("recipes.json", recipes.shard), initDocs: put("init-docs.json", docs.shard) };
  return { catalog: { ...inline, recipes: recipes.templates, inits: docs.inits, shards }, files };
}

export type ShardFetch = {
  fetch: typeof fetch;
  /** Every URL asked for, in order. */
  urls: string[];
};

/**
 * Serves `files` by the end of the URL. `status` answers every request with that status instead; `tamper` serves
 * each file with a byte changed, so its hash no longer matches.
 */
export function shardFetch(files: ReadonlyMap<string, Uint8Array>, options: { status?: number; tamper?: boolean } = {}): ShardFetch {
  const urls: string[] = [];
  const serve = async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    urls.push(url);
    if (options.status !== undefined) return new Response("", { status: options.status });
    const found = [...files].find(([path]) => url.endsWith(`/${path}`));
    if (!found) return new Response("", { status: 404 });
    const bytes = found[1].slice();
    if (options.tamper === true) bytes[bytes.length - 2] = 0x20;
    return new Response(bytes, { status: 200 });
  };
  return { fetch: serve as typeof fetch, urls };
}
