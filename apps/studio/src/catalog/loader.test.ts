/**
 * The real loader, tested directly (not through `provideCatalogLoader`): mocked fetch serves the real
 * `fixtures/catalog/` bytes on disk, so `ShardRef.hash` checks out exactly as it would against the dev
 * server (verified against K3's fixture separately). Success, shard integrity failure, network error and
 * retry, and the fixture flag (Done when).
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { keccak256 } from "viem";
import { getCatalogStatus, setCatalogStatus } from "@/contracts";
import { bufferedServices, clearServiceBuffers } from "@/contracts/services";
import type { CatalogManifest, Result } from "@lattice-studio/core";
import { lines } from "@lattice-studio/core";
import { isFixtureCatalog } from ".";
import { createCatalogLoader, NOT_LOADED } from "./loader";

const FIXTURES = new URL("../../../../fixtures/catalog/", import.meta.url);

function readFixtureBytes(relative: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(relative, FIXTURES)));
}

function bytesResponse(bytes: Uint8Array, status = 200): Response {
  return new Response(bytes.slice().buffer, { status });
}

/** Serves `/catalog/**` from the real fixtures on disk (so hashes check out); anything else 404s. */
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
const MANIFEST_RESULT: Result<CatalogManifest, string> = { ok: true, value: manifest };

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
  setCatalogStatus({ status: "loading" });
  clearServiceBuffers();
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  setCatalogStatus({ status: "loading" });
  clearServiceBuffers();
});

describe("success", () => {
  test("loads the default catalog and logs the first-load line exactly once", async () => {
    globalThis.fetch = fixtureFetch();
    const loader = createCatalogLoader();
    loader.start(MANIFEST_RESULT);
    await waitFor(() => getCatalogStatus().status !== "loading");
    const status = getCatalogStatus();
    expect(status.status).toBe("ready");
    if (status.status !== "ready") return;
    expect(status.id).toBe("fixture");
    const entry = manifest.catalogs.find((c) => c.id === "fixture");
    if (!entry) throw new Error("manifest has no fixture entry");
    expect(status.catalog.hash).toBe(entry.hash);

    const version = status.catalog.lattice.tag.replace(/^v/, "");
    const expected = status.catalog.provisional === undefined
      ? lines.catalogLoaded({ version, facets: status.catalog.facets.length })
      : lines.catalogLoaded({ version, facets: status.catalog.facets.length, provisional: status.catalog.provisional });
    const catalogLines = bufferedServices().log.filter((line) => line.text.startsWith("Catalog:"));
    expect(catalogLines).toHaveLength(1);
    expect(catalogLines[0]?.text).toBe(expected.text);
    expect(catalogLines[0]?.tag).toBe("Note");
  });

  test("the fixture flag: lattice.tag is \"fixture\", surfaced through isFixtureCatalog()", async () => {
    globalThis.fetch = fixtureFetch();
    const loader = createCatalogLoader();
    loader.start(MANIFEST_RESULT);
    await waitFor(() => getCatalogStatus().status === "ready");
    expect(isFixtureCatalog()).toBe(true);
  });

  test("loadShard and loadCode fetch and validate a facet, a library and a multi-entry-point init", async () => {
    globalThis.fetch = fixtureFetch();
    const loader = createCatalogLoader();
    loader.start(MANIFEST_RESULT);
    await waitFor(() => getCatalogStatus().status === "ready");

    const shard = await loader.loadShard("AccessControl");
    expect(shard.ok && shard.value.name).toBe("AccessControl");

    const library = await loader.loadCode("PoseidonT3");
    expect(library.ok).toBe(true);

    const init = await loader.loadCode("DiamondIntrospectionInit");
    expect(init.ok).toBe(true);
  });

  test("warm() fetches a shard once even when called repeatedly", async () => {
    const calls: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      calls.push(url);
      return fixtureFetch()(input);
    }) as typeof fetch;
    const loader = createCatalogLoader();
    loader.start(MANIFEST_RESULT);
    await waitFor(() => getCatalogStatus().status === "ready");
    calls.length = 0;
    loader.warm("AccessControl");
    loader.warm("AccessControl");
    await waitFor(() => calls.some((url) => url.includes("shards/AccessControl.json")));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(calls.filter((url) => url.includes("shards/AccessControl.json"))).toHaveLength(1);
  });
});

describe("shard integrity failure", () => {
  test("a mutated shard fails its hash check and never validates", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("shards/AccessControl.json")) {
        const bytes = readFixtureBytes(url.slice("/catalog/".length));
        const mutated = new Uint8Array(bytes);
        mutated[0] = (mutated[0] ?? 0) ^ 0xff; // flip a byte: still valid-ish bytes, wrong hash
        return bytesResponse(mutated);
      }
      return fixtureFetch()(input);
    }) as typeof fetch;
    const loader = createCatalogLoader();
    loader.start(MANIFEST_RESULT);
    await waitFor(() => getCatalogStatus().status === "ready");

    const shard = await loader.loadShard("AccessControl");
    expect(shard.ok).toBe(false);
    expect(!shard.ok && shard.error).toContain("hash");
  });

  test("code with a wrong hash is refused the same way", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("code/AccessControl.creation.hex")) return new Response("0xdeadbeef");
      return fixtureFetch()(input);
    }) as typeof fetch;
    const loader = createCatalogLoader();
    loader.start(MANIFEST_RESULT);
    await waitFor(() => getCatalogStatus().status === "ready");

    const code = await loader.loadCode("AccessControl");
    expect(code.ok).toBe(false);
    expect(!code.ok && code.error).toContain("hash");
  });
});

describe("hostile shard content", () => {
  test("a shard carrying a __proto__ key is refused, even one otherwise shaped exactly like a valid shard", async () => {
    // Valid enough to pass validateFacetDetail on its own (FacetDetailSchema is a looseObject, which keeps
    // unknown keys rather than rejecting them): only the findProtoKey guard catches the "__proto__" key here.
    const hostile = new TextEncoder().encode(
      '{"name":"AccessControl","abi":[],"natspec":{"functions":{}},"source":{"path":"src/access/AccessControl.sol","url":"x"},"__proto__":{"polluted":true}}',
    );
    const hash = keccak256(hostile);
    const index = JSON.parse(new TextDecoder().decode(readFixtureBytes("fixture/index.json"))) as {
      facets: { name: string; detail?: { path: string; hash: string; bytes: number } }[];
    };
    const facet = index.facets.find((f) => f.name === "AccessControl");
    if (!facet?.detail) throw new Error("fixture has no AccessControl.detail");
    facet.detail = { ...facet.detail, hash, bytes: hostile.byteLength };

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/catalog/fixture/index.json") return bytesResponse(new TextEncoder().encode(JSON.stringify(index)));
      if (url === "/catalog/fixture/shards/AccessControl.json") return bytesResponse(hostile);
      return fixtureFetch()(input);
    }) as typeof fetch;

    const loader = createCatalogLoader();
    loader.start(MANIFEST_RESULT);
    await waitFor(() => getCatalogStatus().status === "ready");

    const shard = await loader.loadShard("AccessControl");
    expect(shard).toEqual({ ok: false, error: "AccessControl's shard doesn't match the shard schema." });
  });
});

describe("network error and retry", () => {
  test("the index request rejecting surfaces its message, and retry reopens the same catalog once fixed", async () => {
    let fail = true;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/catalog/fixture/index.json" && fail) throw new Error("network down");
      return fixtureFetch()(input);
    }) as typeof fetch;
    const loader = createCatalogLoader();
    loader.start(MANIFEST_RESULT);
    await waitFor(() => getCatalogStatus().status === "error");
    expect(getCatalogStatus()).toEqual({ status: "error", reason: "network down" });

    fail = false;
    await loader.retry();
    expect(getCatalogStatus().status).toBe("ready");

    // The first-load line still appears exactly once, on the retry that succeeded.
    expect(bufferedServices().log.filter((line) => line.text.startsWith("Catalog:"))).toHaveLength(1);
  });

  test("loadShard before the catalog is ready reports NOT_LOADED without fetching", async () => {
    globalThis.fetch = fixtureFetch();
    const loader = createCatalogLoader();
    const before = await loader.loadShard("AccessControl");
    expect(before).toEqual({ ok: false, error: NOT_LOADED });
  });

  test("retry refetches the manifest when start() was given a failed result", async () => {
    globalThis.fetch = fixtureFetch();
    const loader = createCatalogLoader();
    loader.start({ ok: false, error: "manifest.json answered 500." });
    expect(getCatalogStatus()).toEqual({ status: "error", reason: "manifest.json answered 500." });

    await loader.retry();
    expect(getCatalogStatus().status).toBe("ready");
  });

  test("a slow first load never overwrites a faster retry (generation guard)", async () => {
    let indexCalls = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/catalog/fixture/index.json") {
        indexCalls += 1;
        if (indexCalls === 1) {
          await new Promise((resolve) => setTimeout(resolve, 40));
          throw new Error("stale attempt");
        }
      }
      return fixtureFetch()(input);
    }) as typeof fetch;
    const loader = createCatalogLoader();
    loader.start(MANIFEST_RESULT); // the slow, failing attempt
    await new Promise((resolve) => setTimeout(resolve, 5));
    await loader.retry(); // starts and finishes before the first attempt does
    await waitFor(() => getCatalogStatus().status === "ready");
    // Give the stale attempt time to resolve; it must not flip status back to error.
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(getCatalogStatus().status).toBe("ready");
  });
});

describe("switchTo (a project pinned to a bundled, non-default catalog)", () => {
  test("loads the entry, keys the detail cache by its own id, and never logs a first-load line", async () => {
    globalThis.fetch = fixtureFetch();
    const loader = createCatalogLoader();
    loader.start(MANIFEST_RESULT);
    await waitFor(() => getCatalogStatus().status === "ready");
    expect(bufferedServices().log.filter((line) => line.text.startsWith("Catalog:"))).toHaveLength(1);

    // Warm a shard under "fixture" before switching, so a stale re-key would be visible as a wrong-dir fetch.
    await loader.loadShard("AccessControl");

    const next = manifest.catalogs.find((entry) => entry.id === "fixture-next");
    if (!next) throw new Error("manifest has no fixture-next entry");
    await loader.switchTo(next, manifest);

    const status = getCatalogStatus();
    expect(status.status).toBe("ready");
    expect(status.status === "ready" && status.id).toBe("fixture-next");
    // Switching to a project's own catalog isn't a fresh boot: no second "Catalog: …" line.
    expect(bufferedServices().log.filter((line) => line.text.startsWith("Catalog:"))).toHaveLength(1);

    const asked: string[] = [];
    const base = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      asked.push(url);
      return base(input);
    }) as typeof fetch;
    const shard = await loader.loadShard("AccessControl");
    expect(shard.ok).toBe(true);
    expect(asked).toEqual(["/catalog/fixture-next/shards/AccessControl.json"]);
  });
});
