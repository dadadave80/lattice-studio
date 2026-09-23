import { describe, expect, test } from "bun:test";
import type { CatalogStatus } from "@/contracts";
import { makeCatalog } from "@lattice-studio/core/testing";
import { resolveCatalogPin, UNPINNED_HASH } from "./pin";

const catalog = makeCatalog({ hash: "0xaaaa" });
const CURRENT_ENTRY = { id: "current", tag: "v0.4.0", commit: "0".repeat(40), hash: "0xaaaa" as const, path: "current/index.json" };
const OLDER_ENTRY = { id: "older", tag: "v0.3.0", commit: "1".repeat(40), hash: "0xbbbb" as const, path: "older/index.json" };
const MANIFEST = { default: "current", catalogs: [CURRENT_ENTRY, OLDER_ENTRY] };
const ready: CatalogStatus = { status: "ready", id: "current", catalog, manifest: MANIFEST };

describe("resolveCatalogPin", () => {
  test("unknown while the catalog is loading or errored", () => {
    expect(resolveCatalogPin({ tag: "v0.4.0", hash: "0xaaaa" }, { status: "loading" })).toEqual({ status: "unknown" });
    expect(resolveCatalogPin({ tag: "v0.4.0", hash: "0xaaaa" }, { status: "error", reason: "offline" })).toEqual({ status: "unknown" });
  });

  test("matches when the project's hash is the loaded catalog's", () => {
    expect(resolveCatalogPin({ tag: "v0.4.0", hash: "0xaaaa" }, ready)).toEqual({ status: "matches" });
  });

  test("matches ignoring hex letter case", () => {
    expect(resolveCatalogPin({ tag: "v0.4.0", hash: "0xAAAA" }, ready)).toEqual({ status: "matches" });
  });

  test("bundled when the project's hash is a different manifest entry", () => {
    expect(resolveCatalogPin({ tag: "v0.3.0", hash: "0xbbbb" }, ready)).toEqual({
      status: "bundled",
      entry: OLDER_ENTRY,
    });
  });

  test("unbundled with the manifest's default as the migrate target", () => {
    expect(resolveCatalogPin({ tag: "v0.2.0", hash: "0xcccc" }, ready)).toEqual({
      status: "unbundled",
      migrateTo: CURRENT_ENTRY,
    });
  });

  test("unknown with no manifest to check against (a seeded test's ready status)", () => {
    expect(resolveCatalogPin({ tag: "v0.2.0", hash: "0xcccc" }, { status: "ready", id: "current", catalog, manifest: null })).toEqual({
      status: "unknown",
    });
  });

  test("unpinned for a fresh project (K2's untitled project, before S1 pins one in)", () => {
    expect(resolveCatalogPin({ tag: "", hash: UNPINNED_HASH }, ready)).toEqual({ status: "unpinned" });
    expect(resolveCatalogPin({ tag: "", hash: UNPINNED_HASH }, { status: "loading" })).toEqual({ status: "unpinned" });
  });
});
