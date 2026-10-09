/**
 * The catalog's lazy parts (Q15): `catalogWithRecipes` fetches recipes.json once per catalog, checks its hash and
 * fills the templates; an inline catalog never fetches; a file that doesn't load, or doesn't match its hash, is an
 * error that says why, and the next call tries again.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { getCatalogStatus, setCatalogStatus } from "@/contracts";
import type { Catalog } from "@lattice-studio/core";
import { loadTemplate } from "@lattice-studio/core";
import { loadFixtureCatalog } from "@lattice-studio/core/testing";
import { catalogWithInitDocs, catalogWithRecipes } from "./parts";
import { shardedCatalog, shardFetch } from "./test-support";

const fixture = loadFixtureCatalog();
if (!fixture.ok) throw new Error(fixture.error);
const inline: Catalog = fixture.value;

let originalFetch: typeof fetch;
beforeEach(() => {
  originalFetch = globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  setCatalogStatus({ status: "loading" });
});

function ready(catalog: Catalog): void {
  setCatalogStatus({ status: "ready", id: "fixture", catalog, manifest: null });
}

describe("catalogWithRecipes", () => {
  test("an index with its recipes inline is itself, with no fetch", async () => {
    const served = shardFetch(new Map());
    globalThis.fetch = served.fetch;
    ready(inline);
    const result = await catalogWithRecipes(inline);
    expect(result).toEqual({ ok: true, value: inline });
    expect(served.urls).toEqual([]);
  });

  test("fetches recipes.json once, and the templates load as they do inline", async () => {
    const { catalog, files } = shardedCatalog(inline);
    const served = shardFetch(files);
    globalThis.fetch = served.fetch;
    ready(catalog);
    expect(loadTemplate(catalog, "ERC20")).toEqual({ ok: false, error: "ERC20's recipe hasn't loaded." });
    const first = await catalogWithRecipes(catalog);
    const second = await catalogWithRecipes(catalog);
    expect(served.urls).toEqual(["/catalog/fixture/recipes.json"]);
    if (!first.ok) throw new Error(first.error);
    expect(second).toEqual(first);
    for (const name of ["GovernedVault", "ERC20", "SafeDiamondCut"]) {
      expect(loadTemplate(first.value, name)).toEqual(loadTemplate(inline, name));
    }
    // The loaded catalog stays the index: nothing republished.
    const status = getCatalogStatus();
    expect(status.status === "ready" && status.catalog).toBe(catalog);
  });

  test("a file that doesn't load says why, and the next call tries again", async () => {
    const { catalog, files } = shardedCatalog(inline);
    globalThis.fetch = shardFetch(files, { status: 404 }).fetch;
    ready(catalog);
    expect(await catalogWithRecipes(catalog)).toEqual({ ok: false, error: "Couldn't load the recipes. recipes.json answered 404." });
    const served = shardFetch(files);
    globalThis.fetch = served.fetch;
    expect((await catalogWithRecipes(catalog)).ok).toBe(true);
    expect(served.urls).toHaveLength(1);
  });

  test("a file that doesn't match its hash isn't used", async () => {
    const { catalog, files } = shardedCatalog(inline);
    globalThis.fetch = shardFetch(files, { tamper: true }).fetch;
    ready(catalog);
    expect(await catalogWithRecipes(catalog)).toEqual({
      ok: false,
      error: "Couldn't load the recipes. recipes.json doesn't match catalog fixture's hash for it. Reload the catalog.",
    });
  });

  test("a catalog that isn't the loaded one isn't fetched for", async () => {
    const { catalog, files } = shardedCatalog(inline);
    const served = shardFetch(files);
    globalThis.fetch = served.fetch;
    setCatalogStatus({ status: "loading" });
    expect(await catalogWithRecipes(catalog)).toEqual({ ok: false, error: "Couldn't load the recipes. The catalog hasn't loaded." });
    expect(served.urls).toEqual([]);
  });
});

describe("catalogWithInitDocs", () => {
  test("puts every doc back where it was, and gives the same object for the same pair", () => {
    const { catalog, files } = shardedCatalog(inline);
    const docs = JSON.parse(new TextDecoder().decode(files.get("init-docs.json"))) as Record<string, Record<string, string>>;
    const filled = catalogWithInitDocs(catalog, docs);
    expect(filled.inits).toEqual(inline.inits);
    expect(catalogWithInitDocs(catalog, docs)).toBe(filled);
  });
});
