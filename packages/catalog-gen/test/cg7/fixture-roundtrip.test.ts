/**
 * Done when: writing K3's fixture catalog (`fixtures/catalog/fixture/`, written by hand, not through
 * `canonicalJson`) through this writer, into a temp dir, gives the same content as the original — compared
 * after re-canonicalizing both sides, since K3's own formatting isn't RFC 8785.
 *
 * This reconstructs a `CatalogInput` from the fixture's already-final `Catalog` (every `ShardRef` replaced by
 * the raw content of the file it points to, read via that exact `path`), writes it, and checks that the
 * writer reproduces every file: the assembled `Catalog` (canonically equal to the original, `hash` included),
 * every shard, every creation-code file and the proxy's standard JSON.
 */
import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  canonicalJson,
  type Catalog,
  type ChainRelease,
  type Facet,
  type FacetDetail,
  type InitSpec,
  type ShardRef,
  type SharedContract,
  validateCatalog,
} from "@lattice-studio/core";
import {
  type CatalogInput,
  type ChainReleaseInput,
  type FacetInput,
  type InitSpecInput,
  type LibraryInput,
  type ProxyInput,
  type SharedContractInput,
  writeCatalog,
} from "../../src/write";

const FIXTURE_DIR = join(import.meta.dir, "..", "..", "..", "..", "fixtures", "catalog", "fixture");

async function readJsonFile(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

async function readShardRef(ref: ShardRef): Promise<unknown> {
  return readJsonFile(join(FIXTURE_DIR, ref.path));
}

async function readCodeRef(ref: ShardRef): Promise<string> {
  return readFile(join(FIXTURE_DIR, ref.path), "utf8");
}

async function sharedContractInput(sc: SharedContract): Promise<SharedContractInput> {
  const { creationCode, detail, ...rest } = sc;
  const input: SharedContractInput = { ...rest, creationCode: await readCodeRef(creationCode) };
  if (detail !== undefined) input.detail = (await readShardRef(detail)) as FacetDetail;
  return input;
}

async function facetInput(facet: Facet): Promise<FacetInput> {
  const { release, detail, ...rest } = facet;
  return { ...rest, release: await sharedContractInput(release), detail: (await readShardRef(detail)) as FacetDetail };
}

async function initInput(init: InitSpec): Promise<InitSpecInput> {
  const { release, ...rest } = init;
  if (release === undefined) return { ...rest };
  return { ...rest, release: await sharedContractInput(release) };
}

async function proxyInput(proxy: Catalog["proxy"]): Promise<ProxyInput> {
  const { creationCode, standardJson, detail, ...rest } = proxy;
  const input: ProxyInput = { ...rest, creationCode: await readCodeRef(creationCode), standardJson: await readShardRef(standardJson) };
  if (detail !== undefined) input.detail = (await readShardRef(detail)) as FacetDetail;
  return input;
}

async function chainInput(chain: ChainRelease): Promise<ChainReleaseInput> {
  if (chain.factory === undefined) return { chainId: chain.chainId };
  const { proxyStandardJson, ...restFactory } = chain.factory;
  return { chainId: chain.chainId, factory: { ...restFactory, proxyStandardJson: await readShardRef(proxyStandardJson) } };
}

async function libraryInput(library: { name: string; release: SharedContract }): Promise<LibraryInput> {
  return { name: library.name, release: await sharedContractInput(library.release) };
}

async function catalogInputFromFixture(catalog: Catalog): Promise<CatalogInput> {
  const input: CatalogInput = {
    lattice: catalog.lattice,
    toolchain: catalog.toolchain,
    deployer: catalog.deployer,
    registry: await sharedContractInput(catalog.registry),
    factory: await sharedContractInput(catalog.factory),
    proxy: await proxyInput(catalog.proxy),
    facets: await Promise.all(catalog.facets.map(facetInput)),
    inits: await Promise.all(catalog.inits.map(initInput)),
    recipes: catalog.recipes,
    chains: await Promise.all(catalog.chains.map(chainInput)),
    seams: catalog.seams,
  };
  if (catalog.provisional !== undefined) input.provisional = catalog.provisional;
  if (catalog.libraries !== undefined) input.libraries = await Promise.all(catalog.libraries.map(libraryInput));
  if (catalog.registryOwner !== undefined) input.registryOwner = catalog.registryOwner;
  return input;
}

async function collectFilePaths(dir: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const paths: string[] = [];
  for (const entry of entries) {
    const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) paths.push(...(await collectFilePaths(join(dir, entry.name), rel)));
    else paths.push(rel);
  }
  return paths.sort();
}

describe("K3's fixture catalog, round-tripped through the writer", () => {
  test("writing it gives the same content, compared after re-canonicalizing both sides", async () => {
    const originalRaw = await readJsonFile(join(FIXTURE_DIR, "index.json"));
    const parsed = validateCatalog(originalRaw);
    if (!parsed.ok) throw new Error(parsed.error.map((issue) => `${issue.path} ${issue.message}`).join("; "));
    const original = parsed.value;

    const input = await catalogInputFromFixture(original);

    const tmp = await mkdtemp(join(tmpdir(), "cg7-fixture-"));
    try {
      const result = await writeCatalog(tmp, "fixture", input);
      if (!result.ok) throw new Error(result.error);

      // The assembled catalog, canonically, is exactly K3's original — hash included.
      expect(canonicalJson(result.value.catalog)).toBe(canonicalJson(original));
      expect(result.value.catalog.hash).toBe(original.hash);

      // The written index.json, read back off disk, is exactly the same catalog.
      const writtenIndex = await readJsonFile(join(result.value.dir, "index.json"));
      expect(canonicalJson(writtenIndex)).toBe(canonicalJson(originalRaw));

      // Every file the original fixture has, the writer reproduced at the same relative path, byte for byte
      // (JSON files compared canonically, since K3's pretty-printing predates RFC 8785; hex files exactly).
      const originalPaths = await collectFilePaths(FIXTURE_DIR);
      const writtenPaths = await collectFilePaths(result.value.dir);
      expect(writtenPaths).toEqual(originalPaths);

      for (const path of originalPaths) {
        const originalPath = join(FIXTURE_DIR, path);
        const writtenPath = join(result.value.dir, path);
        if (path.endsWith(".json")) {
          expect(canonicalJson(await readJsonFile(writtenPath))).toBe(canonicalJson(await readJsonFile(originalPath)));
        } else {
          expect(await readFile(writtenPath, "utf8")).toBe(await readFile(originalPath, "utf8"));
        }
      }
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }, 30_000);

  test("writing it twice gives identical bytes and hash both times (determinism)", async () => {
    const original = await readJsonFile(join(FIXTURE_DIR, "index.json"));
    const parsed = validateCatalog(original);
    if (!parsed.ok) throw new Error("fixture catalog doesn't validate");
    const input = await catalogInputFromFixture(parsed.value);

    const tmpA = await mkdtemp(join(tmpdir(), "cg7-fixture-a-"));
    const tmpB = await mkdtemp(join(tmpdir(), "cg7-fixture-b-"));
    try {
      const [a, b] = await Promise.all([writeCatalog(tmpA, "fixture", input), writeCatalog(tmpB, "fixture", input)]);
      if (!a.ok) throw new Error(a.error);
      if (!b.ok) throw new Error(b.error);
      expect(a.value.catalog.hash).toBe(b.value.catalog.hash);

      const pathsA = await collectFilePaths(a.value.dir);
      const pathsB = await collectFilePaths(b.value.dir);
      expect(pathsA).toEqual(pathsB);
      for (const path of pathsA) {
        const bytesA = await readFile(join(a.value.dir, path));
        const bytesB = await readFile(join(b.value.dir, path));
        expect(bytesA.equals(bytesB)).toBe(true);
      }
    } finally {
      await rm(tmpA, { recursive: true, force: true });
      await rm(tmpB, { recursive: true, force: true });
    }
  }, 30_000);
});
