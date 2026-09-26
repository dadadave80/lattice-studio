/**
 * The committed catalog (`catalog/`), checked without a build: the manifest makes it the default, the index is
 * valid and hashes to itself, every file it references is there with the recorded size and hash (and nothing
 * else is), the provisional mark is set at the pin, shards carry errors and events and point at the right repo,
 * and every shared contract's address follows from its salt and creation code.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  arachnidAddress,
  type Catalog,
  type CatalogManifest,
  catalogHash,
  type SharedContract,
  type ShardRef,
  sharedSalt,
  validateCatalog,
  validateCatalogManifest,
  validateFacetDetail,
} from "@lattice-studio/core";
import { keccak256 } from "viem";
import { REGISTRY_OWNER_PLACEHOLDER } from "../../src/addressing";
import { sortedJsonFileBytes } from "../../src/shards";
import { buildSizeReport, formatSizeReport } from "../../src/size-report";
import { readCatalogFiles } from "../../src/verify";

const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..");
const CATALOG = join(REPO_ROOT, "catalog");
const manifestJson: unknown = JSON.parse(readFileSync(join(CATALOG, "manifest.json"), "utf8"));
const manifest = manifestJson as CatalogManifest;
const DIR = join(CATALOG, manifest.default);
const indexBytes = new Uint8Array(readFileSync(join(DIR, "index.json")));
const index = JSON.parse(new TextDecoder().decode(indexBytes)) as Catalog;
const files = await readCatalogFiles(DIR);

/** Every ShardRef in the index, wherever it sits. */
function shardRefs(value: unknown, out: ShardRef[] = []): ShardRef[] {
  if (Array.isArray(value)) for (const v of value) shardRefs(v, out);
  else if (value !== null && typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (typeof o["path"] === "string" && typeof o["bytes"] === "number" && typeof o["hash"] === "string") out.push(o as ShardRef);
    else for (const v of Object.values(o)) shardRefs(v, out);
  }
  return out;
}

function shared(): { name: string; release: SharedContract }[] {
  return [
    { name: "LatticeRegistry", release: index.registry },
    { name: "LatticeFactory", release: index.factory },
    ...(index.libraries ?? []),
    ...index.facets.map((f) => ({ name: f.name, release: f.release })),
    ...index.inits.flatMap((i) => (i.release ? [{ name: i.contract, release: i.release }] : [])),
  ];
}

describe("catalog/manifest.json", () => {
  test("is valid and makes the pinned dev catalog the default, so the app loads it instead of the fixture", () => {
    expect(validateCatalogManifest(manifestJson).ok).toBe(true);
    expect(manifest.default).toBe(`dev-${index.lattice.commit.slice(0, 7)}`);
    expect(manifest.catalogs).toContainEqual({
      id: manifest.default,
      tag: index.lattice.tag,
      commit: index.lattice.commit,
      hash: index.hash,
      path: `${manifest.default}/index.json`,
    });
  });
});

describe("the committed index", () => {
  test("validates, hashes to its own hash, and is written with sorted keys", () => {
    const valid = validateCatalog(index);
    expect(valid.ok ? [] : valid.error).toEqual([]);
    expect(catalogHash(index)).toBe(index.hash);
    expect(new TextDecoder().decode(indexBytes)).toBe(new TextDecoder().decode(sortedJsonFileBytes(index)));
  });

  test("records the pin, Foundry 1.8.3, solc 0.8.36 and its long version, and is provisional at 0.2.0", () => {
    expect(index.lattice).toEqual({ tag: manifest.default, commit: "f4a32c8330934d39bcfdffff87d35a04b7fa6a79" });
    expect(index.toolchain.foundry).toBe("1.8.3");
    expect(index.toolchain.solc).toBe("0.8.36");
    // FX20: the catalog also carries solc's full version, which Sourcify's v2 API needs to resolve the compiler.
    expect(index.toolchain.solcLong).toMatch(/^0\.8\.36\+commit\.[0-9a-f]{8}$/);
    expect(index.provisional).toBe("Lattice 0.2.0 at dev f4a32c8; v1 targets 0.4.0");
    expect(index.registryOwner).toBe(REGISTRY_OWNER_PLACEHOLDER);
    expect(index.chains).toEqual([]);
  });

  test("100 facets, every init, 84 templates with v1 first, R19's 11 seams and PoseidonT3", () => {
    expect(index.facets).toHaveLength(100);
    expect(index.recipes).toHaveLength(84);
    expect(index.recipes.slice(0, 3).map((r) => r.name)).toEqual(["GovernedVault", "ERC20", "SafeDiamondCut"]);
    for (const r of index.recipes) expect(r.recipe.catalog.tag).toBe(index.lattice.tag);
    expect(index.seams).toHaveLength(11);
    expect(index.libraries?.map((l) => l.name)).toEqual(["PoseidonT3"]);
    expect(index.inits.filter((i) => i.release === undefined).map((i) => i.name)).toEqual(["AccountInit", "AccountInit6900"]);
  });

  test("every referenced file is there with its recorded size and hash, and nothing else is", () => {
    const refs = shardRefs(index);
    const paths = new Set<string>();
    for (const ref of refs) {
      const file = files.get(ref.path);
      expect({ path: ref.path, present: file !== undefined }).toEqual({ path: ref.path, present: true });
      if (file === undefined) continue;
      expect({ path: ref.path, bytes: file.length, hash: keccak256(file) }).toEqual({ path: ref.path, bytes: ref.bytes, hash: ref.hash });
      paths.add(ref.path);
    }
    expect([...files.keys()].filter((p) => p !== "index.json" && !paths.has(p))).toEqual([]);
  });
});

describe("shards", () => {
  const shard = (path: string) => JSON.parse(new TextDecoder().decode(files.get(path))) as unknown;

  test("every facet's, and the registry's, factory's, proxy's and init contracts', is a valid FacetDetail", () => {
    const details = [
      ...index.facets.map((f) => f.detail),
      index.registry.detail,
      index.factory.detail,
      index.proxy.detail,
      ...index.inits.flatMap((i) => (i.release ? [i.release.detail] : [])),
    ];
    for (const ref of details) {
      expect(ref).toBeDefined();
      if (ref === undefined) continue;
      const res = validateFacetDetail(shard(ref.path));
      expect({ path: ref.path, issues: res.ok ? [] : res.error }).toEqual({ path: ref.path, issues: [] });
    }
  });

  test("ABIs carry functions, errors and events, without exportSelectors()", () => {
    const erc20 = shard("shards/ERC20.json") as { abi: { type: string; name?: string }[] };
    const types = new Set(erc20.abi.map((x) => x.type));
    expect(types).toEqual(new Set(["function", "event", "error"]));
    expect(erc20.abi.some((x) => x.name === "Transfer" && x.type === "event")).toBe(true);
    expect(erc20.abi.some((x) => x.name === "ERC20InsufficientBalance" && x.type === "error")).toBe(true);
    for (const f of index.facets) {
      const abi = (shard(f.detail.path) as { abi: { type: string; name?: string }[] }).abi;
      expect({ facet: f.name, exportSelectors: abi.some((x) => x.name === "exportSelectors") }).toEqual({ facet: f.name, exportSelectors: false });
    }
    const registry = shard("shards/LatticeRegistry.json") as { abi: { type: string }[] };
    expect(registry.abi.some((x) => x.type === "error")).toBe(true);
  });

  test("sources point at Lattice's commit, and diamond-lib's at its own repo and pinned commit", () => {
    const erc20 = shard("shards/ERC20.json") as { source: { path: string; url: string } };
    expect(erc20.source).toEqual({
      path: "src/tokens/ERC20/ERC20.sol",
      url: `https://github.com/dadadave80/lattice/blob/${index.lattice.commit}/src/tokens/ERC20/ERC20.sol`,
    });
    const cut = shard("shards/DiamondCutFacet.json") as { source: { path: string; url: string } };
    expect(cut.source).toEqual({
      path: "lib/diamond-lib/src/facets/DiamondCutFacet.sol",
      url: "https://github.com/dadadave80/diamond-lib/blob/393435fbd01a85f9626cd62f436cdebf90ecdfdf/src/facets/DiamondCutFacet.sol",
    });
  });

  test("DiamondIntrospectionInit's two entry points share one release and one shard", () => {
    const specs = index.inits.filter((i) => i.contract === "DiamondIntrospectionInit");
    expect(specs.map((s) => s.name)).toEqual(["DiamondIntrospectionInit.initImmutable", "DiamondIntrospectionInit.initUpgradeable"]);
    expect(specs[0]?.release).toEqual(specs[1]?.release as SharedContract);
    expect(specs[0]?.release?.detail?.path).toBe("shards/DiamondIntrospectionInit.json");
  });
});

describe("shared contracts", () => {
  test("each address is CREATE2 through Arachnid's proxy of its salt and its creation code's hash", () => {
    for (const { name, release } of shared()) {
      const code = new TextDecoder().decode(files.get(release.creationCode.path));
      expect({ name, initCodeHash: keccak256(code as `0x${string}`) }).toEqual({ name, initCodeHash: release.initCodeHash });
      expect({ name, salt: sharedSalt(name, release.version) }).toEqual({ name, salt: release.salt });
      expect({ name, address: arachnidAddress(release.salt, release.initCodeHash) }).toEqual({ name, address: release.address });
    }
    const proxyCode = new TextDecoder().decode(files.get(index.proxy.creationCode.path));
    expect(keccak256(proxyCode as `0x${string}`)).toBe(index.proxy.initCodeHash);
  });

  test("only Semaphore and ShieldedPool link PoseidonT3, and say so", () => {
    const linking = index.facets.filter((f) => f.release.dependsOn !== undefined);
    expect(linking.map((f) => [f.name, f.release.dependsOn])).toEqual([
      ["Semaphore", ["PoseidonT3"]],
      ["ShieldedPool", ["PoseidonT3"]],
    ]);
    for (const f of linking) expect(f.release.provisional).toContain("PoseidonT3");
  });
});

describe("size", () => {
  test("the index's size is reported against the 60 KB gz target (warn-only)", () => {
    const report = buildSizeReport(indexBytes, [...files].filter(([p]) => p !== "index.json").map(([path, b]) => ({ path, bytes: b.length })));
    const text = formatSizeReport(report);
    expect(text).toStartWith(`Catalog index: ${indexBytes.length} B`);
    expect(report.indexGzipBytes).toBeGreaterThan(0);
  });
});
