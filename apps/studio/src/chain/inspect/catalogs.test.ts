import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { Catalog, CatalogManifest } from "@lattice-studio/core";
import { getCatalogStatus, setCatalogStatus } from "@/contracts";
import { isolateContracts } from "@/contracts/test-support";
import { clearCatalogCache } from "@/catalog/lookup";
import { inspectionCatalogs } from "./app";

const ROOT = new URL("../../../../../", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("catalog/manifest.json", ROOT), "utf8")) as CatalogManifest;
const readCatalog = (path: string): Catalog => JSON.parse(readFileSync(new URL(`catalog/${path}`, ROOT), "utf8")) as Catalog;
let restore: () => void;
let previousFetch: typeof fetch;

beforeEach(() => { restore = isolateContracts(); previousFetch = globalThis.fetch; clearCatalogCache(); });
afterEach(() => { globalThis.fetch = previousFetch; clearCatalogCache(); restore(); });

describe("inspection bundled catalogs", () => {
  test("verifies every bundle in default-first order without changing the loaded catalog pin", async () => {
    const loaded = manifest.catalogs.find((entry) => entry.id !== manifest.default)!;
    setCatalogStatus({ status: "ready", id: loaded.id, catalog: readCatalog(loaded.path), manifest });
    const status = getCatalogStatus();
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const path = String(input).replace(/^\/catalog\//, "");
      return new Response(readFileSync(new URL(`catalog/${path}`, ROOT), "utf8"));
    }) as typeof fetch;
    const result = await inspectionCatalogs();
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.value.map((catalog) => catalog.hash)).toEqual([
      manifest.catalogs.find((entry) => entry.id === manifest.default)!.hash,
      ...manifest.catalogs.filter((entry) => entry.id !== manifest.default).map((entry) => entry.hash),
    ]);
    expect(getCatalogStatus()).toBe(status);
  });

  test("rejects a catalog whose contents disagree with its claimed hash", async () => {
    const entry = manifest.catalogs.find((item) => item.id === manifest.default)!;
    const catalog = readCatalog(entry.path);
    setCatalogStatus({ status: "ready", id: entry.id, catalog: { ...catalog, lattice: { ...catalog.lattice, tag: "tampered" } }, manifest });
    const result = await inspectionCatalogs();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("couldn't be verified");
  });

  test("unavailable manifest errors do not reveal fetch exception details", async () => {
    globalThis.fetch = (async () => { throw new Error("https://private.example/secret-token"); }) as unknown as typeof fetch;
    const result = await inspectionCatalogs();
    expect(result).toEqual({ ok: false, error: "The bundled catalog list couldn't be loaded. Retry inspection." });
  });
});
