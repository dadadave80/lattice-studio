/**
 * The document subscription `services.ts` wires up: shards warm for placed facets on every document change
 * (spec L830), and the catalog pin switches to a project's own bundled catalog when it names one other than
 * the one on screen (spec "Catalog pin", L290). Importing `./services` registers the real loader once for
 * this file, the same way `contracts/discover.ts` does for the app.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { doc, getCatalogStatus, setCatalogStatus } from "@/contracts";
import { bufferedServices, clearServiceBuffers } from "@/contracts/services";
import type { CatalogManifest } from "@lattice-studio/core";
import { loadFixtureCatalog, makeProject, makeRecipe } from "@lattice-studio/core/testing";
import { getCatalogPin } from "./pin-store";
import "./services";

const FIXTURES = new URL("../../../../fixtures/catalog/", import.meta.url);
function readFixtureBytes(relative: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(relative, FIXTURES)));
}
function bytesResponse(bytes: Uint8Array, status = 200): Response {
  return new Response(bytes.slice().buffer, { status });
}
function fixtureFetch(): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (!url.startsWith("/catalog/")) return new Response("", { status: 404 });
    try {
      return bytesResponse(readFixtureBytes(url.slice("/catalog/".length)));
    } catch {
      return new Response("", { status: 404 });
    }
  }) as typeof fetch;
}

const manifest = JSON.parse(new TextDecoder().decode(readFixtureBytes("manifest.json"))) as CatalogManifest;
const fixture = loadFixtureCatalog("fixture");
const fixtureNext = loadFixtureCatalog("fixture-next");

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

let originalFetch: typeof fetch;
beforeEach(() => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = fixtureFetch();
  setCatalogStatus({ status: "loading" });
  clearServiceBuffers();
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  setCatalogStatus({ status: "loading" });
  doc.load(makeProject());
  clearServiceBuffers();
});

describe("warming placed facets", () => {
  test.skipIf(!fixture.ok)("fetches every placed facet's shard without useFacetDetail ever being called", async () => {
    if (!fixture.ok) return;
    setCatalogStatus({ status: "ready", id: "fixture", catalog: fixture.value, manifest: null });

    const asked: string[] = [];
    const base = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      asked.push(url);
      return base(input);
    }) as typeof fetch;

    const recipe = makeRecipe({ facets: ["AccessControl", "ERC20"] }, fixture.value);
    doc.load(makeProject({ recipe }));

    await waitFor(() => asked.some((url) => url.includes("shards/ERC20.json")));
    expect(asked.some((url) => url.includes("shards/AccessControl.json"))).toBe(true);
  });
});

describe("the catalog pin", () => {
  test.skipIf(!fixture.ok || !fixtureNext.ok)("matches when a project names the loaded catalog", async () => {
    if (!fixture.ok) return;
    setCatalogStatus({ status: "ready", id: "fixture", catalog: fixture.value, manifest });
    const recipe = makeRecipe({}, fixture.value);
    doc.load(makeProject({ recipe }));
    await waitFor(() => getCatalogPin().status === "matches");
    expect(getCatalogPin()).toEqual({ status: "matches" });
  });

  test.skipIf(!fixture.ok || !fixtureNext.ok)("switches to a project's own bundled catalog when it isn't the one on screen", async () => {
    if (!fixture.ok || !fixtureNext.ok) return;
    setCatalogStatus({ status: "ready", id: "fixture", catalog: fixture.value, manifest });
    const recipe = makeRecipe({}, fixtureNext.value);
    doc.load(makeProject({ recipe }));

    await waitFor(() => {
      const status = getCatalogStatus();
      return status.status === "ready" && status.id === "fixture-next";
    });
    const status = getCatalogStatus();
    expect(status.status === "ready" && status.catalog.hash).toBe(fixtureNext.value.hash);
    await waitFor(() => getCatalogPin().status === "matches");
    // The switch isn't a fresh boot: it never logs a first-load line (the seeded status didn't either).
    expect(bufferedServices().log.filter((line) => line.text.startsWith("Catalog:"))).toHaveLength(0);
  });

  test.skipIf(!fixture.ok)("unbundled, with the manifest's default as the migrate target", async () => {
    if (!fixture.ok) return;
    setCatalogStatus({ status: "ready", id: "fixture", catalog: fixture.value, manifest });
    const recipe = makeRecipe({ catalog: { tag: "v0.1.0", hash: "0xdeadbeef" } });
    doc.load(makeProject({ recipe }));
    await waitFor(() => getCatalogPin().status === "unbundled");
    const pin = getCatalogPin();
    expect(pin.status).toBe("unbundled");
    expect(pin.status === "unbundled" && pin.migrateTo?.id).toBe("fixture");
  });
});
