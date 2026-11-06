import { expect, test } from "bun:test";
import { makeCatalog, makeFacet } from "@lattice-studio/core/testing";
import { err, ok, type CatalogManifest } from "@lattice-studio/core";
import { createInspectionDetails } from "./details";

const facet = makeFacet({ name: "Token" });
const catalog = makeCatalog({ facets: [facet] });
const manifest: CatalogManifest = { default: "old", catalogs: [{ id: "old", tag: catalog.lattice.tag, commit: catalog.lattice.commit, hash: catalog.hash, path: "release-old/index.json" }] };
const detail = { name: "Token", abi: [], natspec: { functions: {} }, source: { path: "Token.sol", url: "https://example.com/Token.sol" } };

test("resolves the facet's catalog directory and immutable shard reference", async () => {
  const seen: unknown[] = [];
  const details = createInspectionDetails({ manifest: async () => ok(manifest), read: async (...args) => { seen.push(args); return ok(JSON.stringify(detail)); } });
  expect(await details.load(catalog, facet)).toEqual(ok(detail));
  expect(seen).toEqual([[manifest.catalogs[0], facet.detail]]);
  expect(await details.load(catalog, facet)).toEqual(ok(detail));
  expect(seen).toHaveLength(1);
});

test("refuses missing catalog, hash-read failure, wrong name and malformed ABI; failures can retry", async () => {
  for (const text of ["{", JSON.stringify({ ...detail, name: "Different" }), JSON.stringify({ ...detail, abi: [{ type: "function" }] })]) {
    const details = createInspectionDetails({ manifest: async () => ok(manifest), read: async () => ok(text) });
    expect((await details.load(catalog, facet)).ok).toBe(false);
  }
  const missing = createInspectionDetails({ manifest: async () => ok({ ...manifest, catalogs: [] }), read: async () => ok(JSON.stringify(detail)) });
  expect((await missing.load(catalog, facet)).ok).toBe(false);
  let reads = 0;
  const retry = createInspectionDetails({ manifest: async () => ok(manifest), read: async () => ++reads === 1 ? err("Hash mismatch") : ok(JSON.stringify(detail)) });
  expect((await retry.load(catalog, facet)).ok).toBe(false);
  expect((await retry.load(catalog, facet)).ok).toBe(true);
});
