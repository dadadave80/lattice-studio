import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { CatalogManifest } from "@lattice-studio/core";
import { catalogDirFor, clearCatalogCache, defaultEntry, entryDir, fetchManifest, findEntry, loadCatalogById } from "./lookup";

const FIXTURES = new URL("../../../../fixtures/catalog/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", FIXTURES), "utf8")) as CatalogManifest;

let originalFetch: typeof fetch;
beforeEach(() => {
  originalFetch = globalThis.fetch;
  clearCatalogCache();
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  clearCatalogCache();
});

describe("manifest entries", () => {
  test("defaultEntry and findEntry", () => {
    expect(defaultEntry(manifest)?.id).toBe("fixture");
    const older = manifest.catalogs.find((entry) => entry.id === "fixture-next");
    expect(older).toBeDefined();
    if (!older) return;
    expect(findEntry(manifest, older.hash)).toEqual(older);
    expect(findEntry(manifest, older.hash.toUpperCase() as typeof older.hash)).toEqual(older);
    expect(findEntry(manifest, "0xdeadbeef")).toBeUndefined();
  });

  test("entryDir and catalogDirFor agree for a listed id", () => {
    const entry = defaultEntry(manifest);
    if (!entry) throw new Error("no default entry");
    expect(entryDir(entry)).toBe("/catalog/fixture/");
    expect(catalogDirFor("fixture", manifest)).toBe("/catalog/fixture/");
  });

  test("catalogDirFor falls back to the bare id with no manifest", () => {
    expect(catalogDirFor("fixture", null)).toBe("/catalog/fixture/");
  });
});

describe("fetchManifest", () => {
  test("fetches and validates manifest.json", async () => {
    globalThis.fetch = (async (_input: RequestInfo | URL) => new Response(JSON.stringify(manifest))) as typeof fetch;
    const result = await fetchManifest();
    expect(result).toEqual({ ok: true, value: manifest });
  });

  test("a non-OK response is an error naming the status", async () => {
    globalThis.fetch = (async (_input: RequestInfo | URL) => new Response("", { status: 500 })) as typeof fetch;
    expect(await fetchManifest()).toEqual({ ok: false, error: "manifest.json answered 500." });
  });

  test("a rejected fetch is an error with its message", async () => {
    globalThis.fetch = (async (_input: RequestInfo | URL): Promise<Response> => {
      throw new Error("offline");
    }) as typeof fetch;
    expect(await fetchManifest()).toEqual({ ok: false, error: "offline" });
  });

  test("invalid JSON against the schema is an error", async () => {
    globalThis.fetch = (async (_input: RequestInfo | URL) => new Response(JSON.stringify({ nope: true }))) as typeof fetch;
    expect(await fetchManifest()).toEqual({ ok: false, error: "manifest.json doesn't match the manifest schema." });
  });
});

describe("loadCatalogById", () => {
  test("fetches once per id and caches after that", async () => {
    const entry = defaultEntry(manifest);
    if (!entry) throw new Error("no default entry");
    let calls = 0;
    globalThis.fetch = (async (_input: RequestInfo | URL) => {
      calls += 1;
      return new Response(readFileSync(new URL("fixture/index.json", FIXTURES), "utf8"));
    }) as typeof fetch;
    const first = await loadCatalogById(entry);
    const second = await loadCatalogById(entry);
    expect(first.ok && first.value.lattice.tag).toBe("fixture");
    expect(second).toEqual(first);
    expect(calls).toBe(1);
  });
});
