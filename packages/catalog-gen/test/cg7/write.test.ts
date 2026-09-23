import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Address, catalogHash, type Hex, type Hex4 } from "@lattice-studio/core";
import {
  assembleCatalog,
  type CatalogFs,
  type CatalogInput,
  type FacetInput,
  type SharedContractInput,
  updateManifest,
  writeCatalog,
} from "../../src/write";

const ADDR = `0x${"11".repeat(20)}` as Address;
const OTHER_ADDR = `0x${"22".repeat(20)}` as Address;
const HASH = `0x${"22".repeat(32)}` as Hex;
const HASH2 = `0x${"33".repeat(32)}` as Hex;
const SALT = `0x${"44".repeat(32)}` as Hex;
const SEL = "0xaaaaaaaa" as Hex4;

function sharedContractInput(overrides?: Partial<SharedContractInput>): SharedContractInput {
  return { salt: SALT, version: "0.1.0", address: ADDR, codehash: HASH, initCodeHash: HASH2, creationCode: "0xfeedface", ...overrides };
}

function facetInput(name: string, overrides?: Partial<FacetInput>): FacetInput {
  return {
    name,
    area: "tokens",
    source: `src/tokens/${name}.sol`,
    summary: `${name} facet.`,
    selectors: [{ hex: SEL, signature: "foo()" }],
    touches: [],
    release: sharedContractInput(),
    requires: [],
    detail: { name, abi: [], natspec: { functions: {} }, source: { path: `src/${name}.sol`, url: "https://example.test/x" } },
    ...overrides,
  };
}

function minimalCatalogInput(overrides?: Partial<CatalogInput>): CatalogInput {
  return {
    lattice: { tag: "test", commit: "deadbeef" },
    toolchain: { foundry: "1.8.3", solc: "0.8.36" },
    deployer: { address: ADDR, codehash: HASH },
    registry: sharedContractInput(),
    factory: sharedContractInput(),
    proxy: { creationCode: "0xc0ffee", initCodeHash: HASH2, standardJson: { language: "Solidity" } },
    facets: [facetInput("ERC20")],
    inits: [],
    recipes: [],
    chains: [],
    seams: [],
    ...overrides,
  };
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "cg7-write-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** The real filesystem, except its `nth` call to `rename` throws instead of renaming. */
function fsFailingOnRenameCall(nth: number, message = "synthetic rename failure"): CatalogFs {
  return fsFailingOnRenameCalls([nth], message);
}

/** The real filesystem, except each call to `rename` in `calls` throws instead of renaming. */
function fsFailingOnRenameCalls(calls: number[], message = "synthetic rename failure"): CatalogFs {
  let n = 0;
  return {
    mkdir,
    writeFile,
    rm,
    readFile,
    rename: async (from, to) => {
      n++;
      if (calls.includes(n)) throw new Error(message);
      await rename(from, to);
    },
  };
}

describe("assembleCatalog", () => {
  test("is deterministic: two calls with the same input give identical bytes and hash", () => {
    const input = minimalCatalogInput();
    const a = assembleCatalog(input);
    const b = assembleCatalog(input);
    expect(a.catalog.hash).toBe(b.catalog.hash);
    const byPath = (files: typeof a.files) =>
      Object.fromEntries(files.map((f) => [f.path, Buffer.from(f.bytes).toString("hex")]));
    expect(byPath(a.files)).toEqual(byPath(b.files));
  });

  test("hash is catalogHash over the assembled catalog itself (round-trips through catalogHash)", () => {
    const { catalog } = assembleCatalog(minimalCatalogInput());
    expect(catalog.hash).toBe(catalogHash(catalog));
  });

  test("omits provisional, libraries and registryOwner when absent", () => {
    const { catalog } = assembleCatalog(minimalCatalogInput());
    expect("provisional" in catalog).toBe(false);
    expect("libraries" in catalog).toBe(false);
    expect("registryOwner" in catalog).toBe(false);
  });

  test("includes provisional, libraries and registryOwner when given, with library file paths from its name", () => {
    const input = minimalCatalogInput({
      provisional: "Lattice 0.2.0 at dev f4a32c8; v1 targets 0.4.0.",
      libraries: [{ name: "PoseidonT3", release: sharedContractInput() }],
      registryOwner: OTHER_ADDR,
    });
    const { catalog } = assembleCatalog(input);
    expect(catalog.provisional).toBe("Lattice 0.2.0 at dev f4a32c8; v1 targets 0.4.0.");
    expect(catalog.registryOwner).toBe(OTHER_ADDR);
    expect(catalog.libraries).toHaveLength(1);
    expect(catalog.libraries?.[0]?.release.creationCode.path).toBe("code/PoseidonT3.creation.hex");
  });

  test("facet and shared-contract file paths follow contracts §4: code/<name>.creation.hex, shards/<name>.json", () => {
    const { catalog } = assembleCatalog(minimalCatalogInput());
    const facet = catalog.facets[0];
    expect(facet?.detail.path).toBe("shards/ERC20.json");
    expect(facet?.release.creationCode.path).toBe("code/ERC20.creation.hex");
    expect(catalog.registry.creationCode.path).toBe("code/LatticeRegistry.creation.hex");
    expect(catalog.factory.creationCode.path).toBe("code/LatticeFactory.creation.hex");
    expect(catalog.proxy.creationCode.path).toBe("code/Lattice.creation.hex");
    expect(catalog.proxy.standardJson.path).toBe("json/Lattice.standard.json");
  });

  test("two inits sharing a contract write its code once, at code/<contract>.creation.hex", () => {
    const input = minimalCatalogInput({
      inits: [
        { name: "X.a", contract: "X", fn: "a()", kind: "step", params: [], initializes: [], after: [], sameCall: [], release: sharedContractInput() },
        { name: "X.b", contract: "X", fn: "b()", kind: "step", params: [], initializes: [], after: [], sameCall: [], release: sharedContractInput() },
      ],
    });
    const { catalog, files } = assembleCatalog(input);
    expect(catalog.inits).toHaveLength(2);
    expect(catalog.inits[0]?.release?.creationCode.path).toBe("code/X.creation.hex");
    expect(catalog.inits[1]?.release?.creationCode.path).toBe("code/X.creation.hex");
    expect(files.filter((f) => f.path === "code/X.creation.hex")).toHaveLength(1);
  });

  test("throws when the same path is given two different contents", () => {
    const input = minimalCatalogInput({
      inits: [
        { name: "X.a", contract: "X", fn: "a()", kind: "step", params: [], initializes: [], after: [], sameCall: [], release: sharedContractInput({ creationCode: "0xaaaa" }) },
        { name: "X.b", contract: "X", fn: "b()", kind: "step", params: [], initializes: [], after: [], sameCall: [], release: sharedContractInput({ creationCode: "0xbbbb" }) },
      ],
    });
    expect(() => assembleCatalog(input)).toThrow(/different contents/);
  });

  test("an init with ctorArgs (deployed per use) writes no release file", () => {
    const input = minimalCatalogInput({
      inits: [{ name: "AccountInit", contract: "AccountInit", fn: "init(address)", kind: "step", params: [], initializes: [], after: [], sameCall: [], ctorArgs: [{ name: "entryPoint", type: "address" }] }],
    });
    const { catalog, files } = assembleCatalog(input);
    expect(catalog.inits[0]?.release).toBeUndefined();
    expect(catalog.inits[0]?.ctorArgs).toEqual([{ name: "entryPoint", type: "address" }]);
    expect(files.some((f) => f.path.includes("AccountInit"))).toBe(false);
  });
});

describe("writeCatalog", () => {
  test("writes every file under <dir>/<id>/ and the written index.json matches the assembled catalog", async () => {
    await withTempDir(async (dir) => {
      const input = minimalCatalogInput();
      const result = await writeCatalog(dir, "fixture", input);
      if (!result.ok) throw new Error(result.error);

      const written = JSON.parse(await readFile(join(result.value.dir, "index.json"), "utf8"));
      expect(written).toEqual(result.value.catalog);

      const shard = JSON.parse(await readFile(join(result.value.dir, "shards", "ERC20.json"), "utf8"));
      expect(shard.name).toBe("ERC20");

      const code = await readFile(join(result.value.dir, "code", "ERC20.creation.hex"), "utf8");
      expect(code).toBe("0xfeedface");
    });
  });

  test("updates catalog/manifest.json, bootstrapping default to the first catalog written", async () => {
    await withTempDir(async (dir) => {
      const result = await writeCatalog(dir, "fixture", minimalCatalogInput());
      if (!result.ok) throw new Error(result.error);
      expect(result.value.manifest.default).toBe("fixture");
      expect(result.value.manifest.catalogs).toEqual([
        { id: "fixture", tag: "test", commit: "deadbeef", hash: result.value.catalog.hash, path: "fixture/index.json" },
      ]);
    });
  });

  test("a second catalog is added alongside the first, without changing the default unless asked", async () => {
    await withTempDir(async (dir) => {
      const first = await writeCatalog(dir, "fixture", minimalCatalogInput());
      if (!first.ok) throw new Error(first.error);
      const second = await writeCatalog(dir, "fixture-next", minimalCatalogInput({ lattice: { tag: "next", commit: "cafef00d" } }));
      if (!second.ok) throw new Error(second.error);
      expect(second.value.manifest.default).toBe("fixture");
      expect(second.value.manifest.catalogs.map((c) => c.id)).toEqual(["fixture", "fixture-next"]);
    });
  });

  test("makeDefault switches the manifest's default", async () => {
    await withTempDir(async (dir) => {
      await writeCatalog(dir, "fixture", minimalCatalogInput());
      const second = await writeCatalog(dir, "fixture-next", minimalCatalogInput({ lattice: { tag: "next", commit: "cafef00d" } }), { makeDefault: true });
      if (!second.ok) throw new Error(second.error);
      expect(second.value.manifest.default).toBe("fixture-next");
    });
  });

  test("re-writing the same id replaces it rather than merging with stale files", async () => {
    await withTempDir(async (dir) => {
      const first = await writeCatalog(dir, "fixture", minimalCatalogInput({ facets: [facetInput("ERC20"), facetInput("ERC721")] }));
      if (!first.ok) throw new Error(first.error);
      const second = await writeCatalog(dir, "fixture", minimalCatalogInput({ facets: [facetInput("ERC20")] }));
      if (!second.ok) throw new Error(second.error);
      expect(await Bun.file(join(second.value.dir, "shards", "ERC721.json")).exists()).toBe(false);
    });
  });

  test("rejects a catalog that fails the Catalog schema instead of writing it", async () => {
    await withTempDir(async (dir) => {
      // A mixed-case address that isn't the valid EIP-55 checksum of itself.
      const badAddress = `0x${"aB".repeat(20)}` as Address;
      const result = await writeCatalog(dir, "fixture", minimalCatalogInput({ deployer: { address: badAddress, codehash: HASH } }));
      expect(result.ok).toBe(false);
      expect(await Bun.file(join(dir, "fixture", "index.json")).exists()).toBe(false);
    });
  });

  test("an assembly failure (conflicting content) comes back as an err Result, not a thrown exception", async () => {
    await withTempDir(async (dir) => {
      const input = minimalCatalogInput({
        inits: [
          { name: "X.a", contract: "X", fn: "a()", kind: "step", params: [], initializes: [], after: [], sameCall: [], release: sharedContractInput({ creationCode: "0xaaaa" }) },
          { name: "X.b", contract: "X", fn: "b()", kind: "step", params: [], initializes: [], after: [], sameCall: [], release: sharedContractInput({ creationCode: "0xbbbb" }) },
        ],
      });
      const result = await writeCatalog(dir, "fixture", input);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected a failure");
      expect(result.error).toContain("different contents");
      expect(await Bun.file(join(dir, "fixture", "index.json")).exists()).toBe(false);
    });
  });

  test("a failure updating manifest.json comes back as an err Result, after the catalog itself was written", async () => {
    await withTempDir(async (dir) => {
      const failing = fsFailingOnRenameCall(3); // 1: backup (ENOENT, no-op), 2: place, 3: manifest.json
      const result = await writeCatalog(dir, "fixture", minimalCatalogInput(), undefined, failing);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected a failure");
      expect(result.error).toContain("failed updating manifest.json");
      expect(await Bun.file(join(dir, "fixture", "index.json")).exists()).toBe(true);
    });
  });
});

describe("writeCatalog: atomic replacement (write atomically)", () => {
  test("a failed rename while placing the new catalog leaves the previous one exactly as it was", async () => {
    await withTempDir(async (dir) => {
      const first = await writeCatalog(dir, "fixture", minimalCatalogInput({ facets: [facetInput("ERC20")] }));
      if (!first.ok) throw new Error(first.error);

      const failing = fsFailingOnRenameCall(2); // 1: backup (succeeds), 2: place (fails)
      const second = await writeCatalog(dir, "fixture", minimalCatalogInput({ facets: [facetInput("ERC721")] }), undefined, failing);
      expect(second.ok).toBe(false);
      if (second.ok) throw new Error("expected a failure");
      expect(second.error).toContain("failed to place the new catalog");

      const stillThere = JSON.parse(await readFile(join(dir, "fixture", "index.json"), "utf8")) as { facets: { name: string }[] };
      expect(stillThere.facets.map((f) => f.name)).toEqual(["ERC20"]);

      const entries = await readdir(dir);
      expect(entries.sort()).toEqual(["fixture", "manifest.json"]);
    });
  });

  test("when the rollback itself also fails, the error names where the previous catalog is stranded", async () => {
    await withTempDir(async (dir) => {
      const first = await writeCatalog(dir, "fixture", minimalCatalogInput({ facets: [facetInput("ERC20")] }));
      if (!first.ok) throw new Error(first.error);

      // 1: backup (succeeds), 2: place (fails), 3: roll the backup back (also fails).
      const failing = fsFailingOnRenameCalls([2, 3]);
      const second = await writeCatalog(dir, "fixture", minimalCatalogInput({ facets: [facetInput("ERC721")] }), undefined, failing);
      expect(second.ok).toBe(false);
      if (second.ok) throw new Error("expected a failure");
      expect(second.error).toContain("failed to place the new catalog");
      expect(second.error).toContain("couldn't be restored and is at");
      expect(second.error).toContain(`${join(dir, "fixture")}.bak-`);
    });
  });

  test("a failed rename while setting the previous catalog aside is reported, and the previous catalog stays", async () => {
    await withTempDir(async (dir) => {
      const first = await writeCatalog(dir, "fixture", minimalCatalogInput({ facets: [facetInput("ERC20")] }));
      if (!first.ok) throw new Error(first.error);

      const failing = fsFailingOnRenameCall(1); // 1: backup (fails, not ENOENT since the dir exists)
      const second = await writeCatalog(dir, "fixture", minimalCatalogInput({ facets: [facetInput("ERC721")] }), undefined, failing);
      expect(second.ok).toBe(false);
      if (second.ok) throw new Error("expected a failure");
      expect(second.error).toContain("failed to set aside the existing catalog");

      const stillThere = JSON.parse(await readFile(join(dir, "fixture", "index.json"), "utf8")) as { facets: { name: string }[] };
      expect(stillThere.facets.map((f) => f.name)).toEqual(["ERC20"]);

      const entries = await readdir(dir);
      expect(entries.sort()).toEqual(["fixture", "manifest.json"]);
    });
  });

  test("writing a fresh id (nothing to back up) still succeeds: the backup rename's ENOENT isn't an error", async () => {
    await withTempDir(async (dir) => {
      const result = await writeCatalog(dir, "fixture", minimalCatalogInput());
      expect(result.ok).toBe(true);
    });
  });
});

describe("index.json's canonical key order (contracts §4)", () => {
  test("every object's keys, at every depth, are sorted", async () => {
    await withTempDir(async (dir) => {
      const result = await writeCatalog(dir, "fixture", minimalCatalogInput());
      if (!result.ok) throw new Error(result.error);
      const parsed = JSON.parse(await readFile(join(result.value.dir, "index.json"), "utf8")) as Record<string, unknown>;
      expect(Object.keys(parsed)).toEqual(Object.keys(parsed).sort());
      const facets = parsed["facets"] as Record<string, unknown>[];
      const facet = facets[0];
      if (facet === undefined) throw new Error("expected a facet");
      expect(Object.keys(facet)).toEqual(Object.keys(facet).sort());
      const release = facet["release"] as Record<string, unknown>;
      expect(Object.keys(release)).toEqual(Object.keys(release).sort());
    });
  });

  test("index.json's bytes don't depend on the order a facet's own fields were given in", async () => {
    const base = facetInput("ERC20");
    const reordered: FacetInput = {
      detail: base.detail,
      touches: base.touches,
      name: base.name,
      release: base.release,
      selectors: base.selectors,
      requires: base.requires,
      area: base.area,
      source: base.source,
      summary: base.summary,
    };
    const dirA = await mkdtemp(join(tmpdir(), "cg7-order-a-"));
    const dirB = await mkdtemp(join(tmpdir(), "cg7-order-b-"));
    try {
      const a = await writeCatalog(dirA, "fixture", minimalCatalogInput({ facets: [base] }));
      const b = await writeCatalog(dirB, "fixture", minimalCatalogInput({ facets: [reordered] }));
      if (!a.ok) throw new Error(a.error);
      if (!b.ok) throw new Error(b.error);
      const textA = await readFile(join(a.value.dir, "index.json"), "utf8");
      const textB = await readFile(join(b.value.dir, "index.json"), "utf8");
      expect(textA).toBe(textB);
    } finally {
      await rm(dirA, { recursive: true, force: true });
      await rm(dirB, { recursive: true, force: true });
    }
  });
});

describe("updateManifest", () => {
  test("starts a fresh manifest when none exists yet", async () => {
    await withTempDir(async (dir) => {
      const manifest = await updateManifest(dir, { id: "a", tag: "a", commit: "aaa", hash: HASH, path: "a/index.json" });
      expect(manifest).toEqual({ default: "a", catalogs: [{ id: "a", tag: "a", commit: "aaa", hash: HASH, path: "a/index.json" }] });
    });
  });

  test("upserts by id: writing the same id again replaces its entry", async () => {
    await withTempDir(async (dir) => {
      await updateManifest(dir, { id: "a", tag: "a", commit: "aaa", hash: HASH, path: "a/index.json" });
      const manifest = await updateManifest(dir, { id: "a", tag: "a2", commit: "bbb", hash: HASH2, path: "a/index.json" });
      expect(manifest.catalogs).toEqual([{ id: "a", tag: "a2", commit: "bbb", hash: HASH2, path: "a/index.json" }]);
    });
  });
});
