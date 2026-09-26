/**
 * `proxyRef` (chain-specific factory vs. the catalog tag's own proxy build) and `loadProxyBuild` against the real
 * built catalog (`catalog/`, CG8) and its own standard JSON bytes on disk, so the hash check runs against real
 * data, not an invented fixture.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { Catalog, ShardRef } from "@lattice-studio/core";
import { loadBuiltCatalog } from "@lattice-studio/core/testing";
import { catalogDirFor, type ManifestEntry } from "@/catalog";
import { setCatalogStatus } from "@/contracts";
import { isolateContracts } from "@/contracts/test-support";
import type { VerifyFetch } from "./ports";
import { loadProxyBuild, proxyRef } from "./standard-json";

const built = loadBuiltCatalog();
if (!built.ok) throw new Error(built.error);
const catalog: Catalog = built.value;

const root = new URL("../../../../../catalog/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", root), "utf8")) as { default: string; catalogs: ManifestEntry[] };
const entry = manifest.catalogs.find((c) => c.id === manifest.default);
if (!entry) throw new Error("no default catalog entry");
const entryId = entry.id;
const entryRoot = new URL(entry.path.replace(/index\.json$/, ""), root);

/** A fetch that reads bytes straight off disk under `catalog/<entry>/`, by the path `catalogDirFor` builds. */
function diskFetch(dir: string): VerifyFetch {
  return async (input) => {
    const url = String(input);
    if (!url.startsWith(dir)) throw new Error(`unexpected fetch: ${url}`);
    return new Response(readFileSync(new URL(url.slice(dir.length), entryRoot)));
  };
}

let restore: () => void;

beforeEach(() => {
  restore = isolateContracts();
});

afterEach(() => {
  restore();
});

describe("proxyRef", () => {
  test("the catalog tag's own build when the chain has no factory of its own", () => {
    expect(proxyRef(catalog, 11155111, "factory")).toBe(catalog.proxy.standardJson);
  });

  test("a chain-specific factory's build commit, only on the factory path", () => {
    const chainSpecific: ShardRef = { path: "json/ChainFactory.standard.json", bytes: 1, hash: "0x00" };
    const withFactory: Catalog = {
      ...catalog,
      chains: [{
        chainId: 8453,
        factory: { address: catalog.factory.address, codehash: "0x00", buildCommit: "abc123", proxyStandardJson: chainSpecific, proxyInitCodeHash: "0x00" },
      }],
    };
    expect(proxyRef(withFactory, 8453, "factory")).toBe(chainSpecific);
    // CreateX deploys the plain proxy everywhere: the chain-specific factory build doesn't apply.
    expect(proxyRef(withFactory, 8453, "createx")).toBe(catalog.proxy.standardJson);
    // A chain without its own factory falls back to the general build.
    expect(proxyRef(withFactory, 1, "factory")).toBe(catalog.proxy.standardJson);
  });
});

describe("loadProxyBuild", () => {
  function ready(): string {
    setCatalogStatus({ status: "ready", id: entryId, catalog, manifest });
    return catalogDirFor(entryId, manifest);
  }

  test("fetches, hash-checks and parses the real standard JSON, with the catalog's compiler version", async () => {
    const dir = ready();
    const result = await loadProxyBuild(diskFetch(dir), 11155111, "factory");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // This catalog predates FX20 (no `solcLong` yet): the short form is the fallback this test exercises too.
    expect(result.value.compilerVersion).toBe(catalog.toolchain.solc);
    const raw = readFileSync(new URL(catalog.proxy.standardJson.path, entryRoot), "utf8");
    expect(result.value.stdJsonInput).toEqual(JSON.parse(raw));
  });

  test("prefers the compiler's long version once the catalog carries one (FX20)", async () => {
    const withLong: Catalog = { ...catalog, toolchain: { ...catalog.toolchain, solcLong: "0.8.36+commit.8a97fa7a" } };
    setCatalogStatus({ status: "ready", id: entryId, catalog: withLong, manifest });
    const dir = catalogDirFor(entryId, manifest);
    const result = await loadProxyBuild(diskFetch(dir), 11155111, "factory");
    expect(result).toMatchObject({ ok: true, value: { compilerVersion: "0.8.36+commit.8a97fa7a" } });
  });

  test("falls back to the short solc version when the catalog has no long one", async () => {
    const withoutLong: Catalog = { ...catalog, toolchain: { foundry: catalog.toolchain.foundry, solc: catalog.toolchain.solc } };
    setCatalogStatus({ status: "ready", id: entryId, catalog: withoutLong, manifest });
    const dir = catalogDirFor(entryId, manifest);
    const result = await loadProxyBuild(diskFetch(dir), 11155111, "factory");
    expect(result).toMatchObject({ ok: true, value: { compilerVersion: catalog.toolchain.solc } });
  });

  test("reports a hash mismatch instead of returning tampered bytes", async () => {
    ready();
    const tampered: VerifyFetch = async () => new Response("{}");
    const result = await loadProxyBuild(tampered, 11155111, "factory");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("doesn't match the catalog's hash");
  });

  test("says so when the catalog hasn't loaded", async () => {
    const result = await loadProxyBuild((async () => new Response("{}")) as VerifyFetch, 1, "factory");
    expect(result).toEqual({ ok: false, error: "The catalog hasn't loaded." });
  });

  test("a 404 on the shard is reported, not thrown", async () => {
    ready();
    const missing: VerifyFetch = async () => new Response("not found", { status: 404 });
    const result = await loadProxyBuild(missing, 11155111, "factory");
    expect(result.ok).toBe(false);
  });
});
