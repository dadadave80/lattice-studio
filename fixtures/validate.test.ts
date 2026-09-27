/**
 * The fixture catalogs (`fixtures/catalog/`) against K1's schemas, the release formulas and Lattice's source at
 * the pin. Source checks read `LATTICE_DIR` (or the `lattice/` submodule) and skip when neither is checked out.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { keccak256, toFunctionSelector } from "viem";
import type { Catalog, Facet, InitParam, SharedContract, ShardRef } from "../packages/core/src/model/catalog.ts";
import type { Hex, Hex4 } from "../packages/core/src/model/hex.ts";
import type { Recipe } from "../packages/core/src/model/recipe.ts";
import { ARACHNID_PROXY_CODEHASH } from "../packages/core/src/address/shared.ts";
import { catalogHash } from "../packages/core/src/canonical/hash.ts";
import { validateCatalogManifest } from "../packages/core/src/model/schema.ts";
import { loadFixtureCatalog, loadFixtureShard } from "../packages/core/src/testing/fixtures.ts";
import { ARACHNID, create2Address, erc7201Slot, fileHash, indexHash, releaseSalt, versionlessSalt } from "./gen/formulas.ts";
import { latticeDir, readExportSelectors, readInventory, readScriptCuts } from "./gen/lattice-source.ts";

const ROOT = join(import.meta.dir, "catalog");
const GOLDEN = join(import.meta.dir, "..", "golden", "expected");
const IDS = ["fixture", "fixture-next"] as const;
const EXPORT_SELECTORS = "0x0ef22643";

function load(id: string): Catalog {
  const result = loadFixtureCatalog(id);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

const catalogs = { fixture: load("fixture"), "fixture-next": load("fixture-next") };
const fixture = catalogs.fixture;
const next = catalogs["fixture-next"];
const lattice = latticeDir();

function facetOf(catalog: Catalog, name: string): Facet {
  const facet = catalog.facets.find((f) => f.name === name);
  if (!facet) throw new Error(`no facet ${name}`);
  return facet;
}

function template(catalog: Catalog, name: string): Recipe {
  const t = catalog.recipes.find((r) => r.name === name);
  if (!t) throw new Error(`no template ${name}`);
  return t.recipe;
}

// ── routing, as the spec defines it (R1, R19, spec L167-L174, L302), for counting ──────────────────

type Routing = {
  /** Selectors the placed facets export, counted per facet. */
  exported: number;
  /** Selector → the facet that serves it. */
  routed: Map<Hex4, string>;
  /** Contested selectors that nothing resolves (would be SEL-01). */
  unresolved: Hex4[];
  /** Placed facets that route only some of their selectors, in catalog order. */
  partial: string[];
};

function route(catalog: Catalog, recipe: Pick<Recipe, "facets" | "owners" | "exclude">): Routing {
  const placed = catalog.facets.filter((f) => recipe.facets.includes(f.name));
  const names = new Set(placed.map((f) => f.name));
  const contenders = new Map<Hex4, string[]>();
  for (const f of placed) for (const { hex } of f.selectors) contenders.set(hex, [...(contenders.get(hex) ?? []), f.name]);
  const routed = new Map<Hex4, string>();
  const unresolved: Hex4[] = [];
  for (const [hex, from] of contenders) {
    if (recipe.exclude.includes(hex)) continue;
    if (from.length === 1 && from[0]) {
      routed.set(hex, from[0]);
      continue;
    }
    // Seams first, then explicit owners, then default owners (spec L302).
    const seam = catalog.seams.find((s) => s.selector === hex && s.when.every((w) => names.has(w)));
    const defaults = from.filter((name) => facetOf(catalog, name).defaultOwnerOf?.includes(hex));
    const owner = seam?.anyOf.find((a) => names.has(a)) ?? recipe.owners[hex] ?? (defaults.length === 1 ? defaults[0] : undefined);
    if (owner) routed.set(hex, owner);
    else unresolved.push(hex);
  }
  const served = (name: string): number => [...routed.values()].filter((v) => v === name).length;
  return {
    exported: placed.reduce((n, f) => n + f.selectors.length, 0),
    routed,
    unresolved,
    partial: placed.filter((f) => served(f.name) < f.selectors.length).map((f) => f.name),
  };
}

// ── schemas, files and formulas ────────────────────────────────────────────────────────────────────

describe("both catalogs parse with K1's schemas", () => {
  for (const id of IDS) {
    test(`${id}: index and every shard`, () => {
      const catalog = catalogs[id];
      expect(catalog.lattice.tag).toBe(id);
      for (const facet of catalog.facets) {
        const shard = loadFixtureShard(facet.name, id);
        expect(shard.ok ? shard.value.name : shard.error).toBe(facet.name);
      }
    });
  }

  test("manifest lists both, with their hashes, fixture first and default", () => {
    const manifest = validateCatalogManifest(JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8")));
    if (!manifest.ok) throw new Error(JSON.stringify(manifest.error));
    expect(manifest.value.default).toBe("fixture");
    expect(manifest.value.catalogs.map((c) => [c.id, c.tag, c.hash, c.commit])).toEqual(
      IDS.map((id) => [id, id, catalogs[id].hash, catalogs[id].lattice.commit]),
    );
    for (const c of manifest.value.catalogs) expect(existsSync(join(ROOT, c.path))).toBe(true);
  });
});

function shardRefs(catalog: Catalog): ShardRef[] {
  const releases: SharedContract[] = [catalog.registry, catalog.factory, ...catalog.facets.map((f) => f.release)];
  for (const init of catalog.inits) if (init.release) releases.push(init.release);
  for (const lib of catalog.libraries ?? []) releases.push(lib.release);
  return [
    catalog.proxy.creationCode,
    catalog.proxy.standardJson,
    ...releases.map((r) => r.creationCode),
    ...catalog.facets.map((f) => f.detail),
  ];
}

describe("files and hashes", () => {
  for (const id of IDS) {
    test(`${id}: every ShardRef names a file with its byte count and keccak256`, () => {
      for (const ref of shardRefs(catalogs[id])) {
        const bytes = new Uint8Array(readFileSync(join(ROOT, id, ref.path)));
        expect({ path: ref.path, bytes: bytes.length, hash: fileHash(bytes) }).toEqual(ref);
      }
    });

    test(`${id}: hash is keccak256 of the canonical index without its hash`, () => {
      const raw = JSON.parse(readFileSync(join(ROOT, id, "index.json"), "utf8")) as Record<string, unknown>;
      expect(indexHash(raw)).toBe(catalogs[id].hash);
      expect(catalogHash(catalogs[id])).toBe(catalogs[id].hash);
    });

    test(`${id}: no file anywhere mentions exportSelectors() 0x0ef22643`, () => {
      const stack = [join(ROOT, id)];
      let files = 0;
      while (stack.length) {
        const dir = stack.pop() as string;
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const path = join(dir, entry.name);
          if (entry.isDirectory()) stack.push(path);
          else {
            files++;
            expect(readFileSync(path, "utf8").includes(EXPORT_SELECTORS.slice(2))).toBe(false);
          }
        }
      }
      expect(files).toBeGreaterThan(200);
      for (const f of catalogs[id].facets) expect(f.selectors.map((s) => s.hex)).not.toContain(EXPORT_SELECTORS);
    });
  }
});

describe("release data is fake but formula-correct", () => {
  const version = facetOf(fixture, "ERC20").release.version;

  function initCode(id: string, release: SharedContract): Hex {
    return readFileSync(join(ROOT, id, release.creationCode.path), "utf8") as Hex;
  }

  function expectRelease(id: string, release: SharedContract, salt: Hex): void {
    expect(release.salt).toBe(salt);
    expect(release.version).toBe(version);
    expect(keccak256(initCode(id, release))).toBe(release.initCodeHash);
    expect(release.address).toBe(create2Address(salt, release.initCodeHash));
  }

  for (const id of IDS) {
    test(`${id}: facet, init, registry and factory releases`, () => {
      const catalog = catalogs[id];
      expect(catalog.deployer).toEqual({ address: ARACHNID, codehash: ARACHNID_PROXY_CODEHASH });
      for (const f of catalog.facets) expectRelease(id, f.release, releaseSalt(f.name, version));
      for (const init of catalog.inits) {
        if (init.ctorArgs) expect(init.release).toBeUndefined();
        else if (init.release) expectRelease(id, init.release, releaseSalt(init.contract, version));
        else throw new Error(`${init.name} has neither ctorArgs nor a release`);
      }
      for (const lib of catalog.libraries ?? []) expectRelease(id, lib.release, releaseSalt(lib.name, version));
      expectRelease(id, catalog.registry, versionlessSalt("LatticeRegistry"));
      expectRelease(id, catalog.factory, versionlessSalt("LatticeFactory"));
      expect(keccak256(readFileSync(join(ROOT, id, catalog.proxy.creationCode.path), "utf8") as Hex)).toBe(catalog.proxy.initCodeHash);
    });
  }

  for (const id of IDS) {
    test(`${id}: PoseidonT3 is a library; Semaphore and ShieldedPool depend on it; registryOwner is D6's placeholder`, () => {
      const catalog = catalogs[id];
      expect(catalog.libraries?.map((l) => l.name)).toEqual(["PoseidonT3"]);
      expect(catalog.registryOwner).toBe("0x000000000000000000000000000000000000dEaD");
      const libraries = new Set(catalog.libraries?.map((l) => l.name));
      const dependents = catalog.facets.filter((f) => f.release.dependsOn).map((f) => f.name);
      expect(dependents).toEqual(["Semaphore", "ShieldedPool"]);
      for (const name of dependents) {
        const release = facetOf(catalog, name).release;
        expect(release.dependsOn).toEqual(["PoseidonT3"]);
        expect(release.provisional).toBe("links PoseidonT3, which Lattice doesn't pin yet");
        for (const dep of release.dependsOn ?? []) expect(libraries.has(dep)).toBe(true);
      }
      expect(catalog.facets.filter((f) => f.release.provisional).map((f) => f.name)).toEqual(dependents);
    });
  }

  test("the fake code is obviously fake: each init code reads fixture:<Name>", () => {
    const code = initCode("fixture", facetOf(fixture, "ERC20").release);
    expect(Buffer.from(code.slice(2), "hex").toString("utf8")).toBe("fixture:ERC20");
    expect(fixture.lattice.tag).toBe("fixture");
    expect(fixture.toolchain).toEqual({ foundry: "1.8.3", solc: "0.8.36" });
  });

  test("storage slots follow ERC-7201 (R13)", () => {
    for (const f of fixture.facets) if (f.storage) expect(f.storage.slot).toBe(erc7201Slot(f.storage.id));
  });

  for (const id of IDS) {
    test(`${id}: no two facets declare the same storage id or slot`, () => {
      const owned = catalogs[id].facets.flatMap((f) => (f.storage ? [f.storage] : []));
      expect(new Set(owned.map((s) => s.id)).size).toBe(owned.length);
      expect(new Set(owned.map((s) => s.slot)).size).toBe(owned.length);
    });
  }

  test("DiamondCutFacet and DiamondLoupeFacet only touch diamond.lib.storage, as OwnableFacet does", () => {
    for (const name of ["DiamondCutFacet", "DiamondLoupeFacet", "OwnableFacet"]) {
      expect(facetOf(fixture, name).storage).toBeUndefined();
      expect(facetOf(fixture, name).touches).toContain("diamond.lib.storage");
    }
    expect(facetOf(fixture, "DiamondCutFacet").summary).not.toBe(facetOf(fixture, "OwnableFacet").summary);
  });
});

// ── the catalog's shape ────────────────────────────────────────────────────────────────────────────

describe("names and references", () => {
  for (const id of IDS) {
    const catalog = catalogs[id];

    test(`${id}: 100 facets with unique names; unique init and template names`, () => {
      const unique = (xs: string[]): void => expect(new Set(xs).size).toBe(xs.length);
      expect(catalog.facets).toHaveLength(100);
      unique(catalog.facets.map((f) => f.name));
      unique(catalog.inits.map((i) => i.name));
      unique(catalog.recipes.map((r) => r.name));
      unique(catalog.seams.map((s) => `${s.selector}:${s.when.join()}`));
      for (const f of catalog.facets) unique(f.selectors.map((s) => s.hex));
      expect(catalog.facets.map((f) => f.name)).not.toContain("TimelockControllerStandalone");
    });

    test(`${id}: signatures hash to their selectors; Receive exports only 0x00000000 as receive()`, () => {
      for (const f of catalog.facets) {
        for (const s of f.selectors) if (f.name !== "Receive") expect(toFunctionSelector(`function ${s.signature}`)).toBe(s.hex);
      }
      expect(facetOf(catalog, "Receive").selectors).toEqual([{ hex: "0x00000000", signature: "receive()" }]);
    });

    test(`${id}: every seam, requirement, default owner and facet init resolves`, () => {
      const facets = new Set(catalog.facets.map((f) => f.name));
      const inits = new Set(catalog.inits.map((i) => i.name));
      for (const s of catalog.seams) {
        for (const name of [...s.when, ...s.anyOf]) expect(facets.has(name) ? name : `missing ${name}`).toBe(name);
        for (const name of s.anyOf) expect(facetOf(catalog, name).selectors.map((x) => x.hex)).toContain(s.selector);
      }
      for (const f of catalog.facets) {
        for (const r of f.requires) for (const name of r.anyOf) expect(facets.has(name)).toBe(true);
        for (const hex of f.defaultOwnerOf ?? []) expect(f.selectors.map((x) => x.hex)).toContain(hex);
        if (f.init) expect(inits.has(f.init) ? f.init : `missing ${f.init}`).toBe(f.init);
      }
    });

    test(`${id}: every template references existing facets and inits, in catalog order`, () => {
      const order = catalog.facets.map((f) => f.name);
      const inits = new Set(catalog.inits.map((i) => i.name));
      for (const { name, recipe } of catalog.recipes) {
        expect(recipe.catalog.tag).toBe(id);
        const positions = recipe.facets.map((f) => order.indexOf(f));
        expect(positions.every((p) => p >= 0) ? name : `${name} names a missing facet`).toBe(name);
        expect(positions).toEqual([...positions].sort((a, b) => a - b));
        const specs = recipe.init.kind === "bundle" ? [recipe.init.spec] : recipe.init.kind === "steps" ? recipe.init.steps.map((s) => s.spec) : [];
        for (const spec of specs) expect(inits.has(spec) ? spec : `${name}: missing ${spec}`).toBe(spec);
        for (const [hex, owner] of Object.entries(recipe.owners)) {
          expect(recipe.facets).toContain(owner);
          expect(facetOf(catalog, owner).selectors.map((s): string => s.hex)).toContain(hex);
        }
        const placedSelectors = recipe.facets.flatMap((f) => facetOf(catalog, f).selectors.map((s) => s.hex));
        for (const hex of recipe.exclude) expect(placedSelectors).toContain(hex);
        expect(route(catalog, recipe).unresolved).toEqual([]);
      }
    });
  }
});

describe("overlay facts the v1 flows need", () => {
  test("families: the five upgrade mechanisms (R4), the AccessControl variants, one marker per account model", () => {
    const family = (name: string): string[] => fixture.facets.filter((f) => f.family === name).map((f) => f.name).sort();
    expect(family("upgrade")).toEqual(["AccessControlDiamondCut", "DiamondCutFacet", "GovernedDiamondCut", "GovernedSafeDiamondCut", "SafeDiamondCut"]);
    expect(family("access")).toEqual(["AccessControl", "AccessControlEnumerable", "AccessControlTimed"]);
    expect(family("account")).toEqual(["AccountSigner", "ERC6900Validation"]);
  });

  test("VaultCore requires ERC4626 (hard); the four cut mechanisms ship with EmergencyStop (convention)", () => {
    expect(facetOf(fixture, "VaultCore").requires).toContainEqual({
      anyOf: ["ERC4626"],
      strength: "hard",
      reason: "it runs the assets behind ERC4626's shares and initializes after it",
    });
    expect(facetOf(fixture, "GovernedDiamondCut").requires).toContainEqual({
      anyOf: ["EmergencyStop"],
      strength: "convention",
      reason: "a guardian can halt upgrades",
    });
    for (const name of ["AccessControlDiamondCut", "SafeDiamondCut", "GovernedSafeDiamondCut"]) {
      expect(facetOf(fixture, name).requires).toEqual([{ anyOf: ["EmergencyStop"], strength: "convention", reason: "a guardian can halt upgrades" }]);
    }
    // Role writers carry no requires on AccessControl: C3 derives namespace DEP-02 from touches (contracts §4).
    for (const f of fixture.facets) for (const r of f.requires) expect([f.name, r.anyOf.includes("AccessControl")]).toEqual([f.name, false]);
  });

  test("`after` names modules, and every fixture spec satisfies its own", () => {
    const vault = fixture.inits.find((i) => i.name === "VaultCoreInit");
    expect(vault?.after).toEqual(["AccessControl", "ERC4626"]);
    for (const spec of fixture.inits) {
      const own = spec.initializes.map((m) => m.module);
      for (const m of spec.after) expect([spec.name, m, own.includes(m)]).toEqual([spec.name, m, true]);
    }
  });

  test("R19's seams, exactly", () => {
    const seams = fixture.seams.map((s) => [s.selector, s.when, s.anyOf]);
    expect(seams).toEqual([
      ["0xa9059cbb", ["ERC20Votes"], ["GovernedVault", "ERC20Votes"]],
      ["0x23b872dd", ["ERC20Votes"], ["GovernedVault", "ERC20Votes"]],
      ["0x5c19a95c", ["ERC20Votes"], ["ERC20Votes"]],
      ["0xc3cda520", ["ERC20Votes"], ["ERC20Votes"]],
      ["0x6e553f65", ["GovernedVault"], ["GovernedVault"]],
      ["0x94bf804d", ["GovernedVault"], ["GovernedVault"]],
      ["0xb460af94", ["GovernedVault"], ["GovernedVault"]],
      ["0xba087652", ["GovernedVault"], ["GovernedVault"]],
      ["0x8ff262e3", ["GovernedVault"], ["GovernedVault"]],
      ["0x01e1d114", ["GovernedVault"], ["VaultCore"]],
      ["0x313ce567", ["GovernedVault"], ["ERC4626"]],
    ]);
  });

  test("DiamondCutFacet's and OwnableFacet's init is OwnableInit, which initializes Ownable", () => {
    expect(facetOf(fixture, "DiamondCutFacet").init).toBe("OwnableInit");
    expect(facetOf(fixture, "OwnableFacet").init).toBe("OwnableInit");
    const ownable = fixture.inits.find((i) => i.name === "OwnableInit");
    expect(ownable?.fn).toBe("init(address)");
    expect(ownable?.initializes.map((m) => m.module)).toEqual(["Ownable"]);
  });

  test("InitSpecs: the required set, their selectors and registersInterfaces (contracts §3.1)", () => {
    const byName = new Map(fixture.inits.map((i) => [i.name, i]));
    for (const name of [
      "VaultCoreInit", "ERC4626Init", "ERC20PermitInit", "ERC6538RegistryInit", "SafeDiamondCutInit", "GovernedSafeDiamondCutInit",
      "AccessControlInit", "OwnableInit", "ERC165Init", "MultiInit", "GovernedVaultInit", "ERC20Init",
      "DiamondIntrospectionInit.initUpgradeable", "DiamondIntrospectionInit.initImmutable",
    ]) {
      expect(byName.has(name) ? name : `missing ${name}`).toBe(name);
    }
    const selector = (name: string): Hex => toFunctionSelector(`function ${byName.get(name)?.fn ?? ""}`);
    expect(selector("MultiInit")).toBe("0x6e02fa3c");
    expect(selector("DiamondIntrospectionInit.initUpgradeable")).toBe("0xfdff4c12");
    expect(selector("DiamondIntrospectionInit.initImmutable")).toBe("0xd1a4dbd8");
    expect(selector("GovernedVaultInit")).toBe("0x7ee12e1b");
    expect(fixture.inits.filter((i) => i.registersInterfaces).map((i) => i.name).sort()).toEqual([
      "AccountInit", "AccountInit6900", "DiamondIntrospectionInit.initImmutable", "DiamondIntrospectionInit.initUpgradeable",
      "GovernedDiamondCutInit", "GovernedSafeDiamondCutInit", "GovernedVaultInit", "SafeDiamondCutInit",
    ]);
    const modules = (name: string): string[] => byName.get(name)?.initializes.map((m) => m.module) ?? [];
    expect(modules("VaultCoreInit")).toEqual(["AccessControl", "ERC20", "ERC4626", "VaultCore"]);
    expect(modules("ERC4626Init")).toEqual(["ERC20", "ERC4626"]);
    expect(byName.get("ERC20PermitInit")?.initializes[0]).toEqual({ module: "EIP712", with: { name: "name_", version: "1" } });
    expect(byName.get("ERC6538RegistryInit")?.initializes[0]).toEqual({ module: "EIP712", with: { name: "ERC6538Registry", version: "1.0" } });
  });

  test("GovernedVaultInit: one struct parameter p with GovernedVaultParams' nine fields and GrantExample's examples", () => {
    const spec = fixture.inits.find((i) => i.name === "GovernedVaultInit");
    expect(spec?.kind).toBe("bundle");
    const p = spec?.params[0] as InitParam;
    expect(spec?.params).toHaveLength(1);
    expect([p.name, p.type]).toEqual(["p", "tuple"]);
    const fields = p.components ?? [];
    expect(fields.map((c) => [c.name, c.type])).toEqual([
      ["asset", "address"], ["name", "string"], ["symbol", "string"], ["decimalsOffset", "uint8"], ["minDelay", "uint256"],
      ["votingDelay", "uint48"], ["votingPeriod", "uint32"], ["proposalThreshold", "uint256"], ["quorumNumerator", "uint256"],
    ]);
    // GrantExample.s.sol:26: GovernedVaultParams(asset, "Grant vault", "gVLT", 0, 300, 60, 600, 0, 4).
    expect(fields.map((c) => c.example ?? null)).toEqual([null, "Grant vault", "gVLT", "0", "300", "60", "600", "0", "4"]);
    expect(fields.find((c) => c.name === "quorumNumerator")).toMatchObject({ unit: "percent", rule: "range(0,100)" });
    expect(fields.find((c) => c.name === "votingPeriod")).toMatchObject({ unit: "seconds", rule: "gt(0)" });
    // GovernedVaultInit.sol:48-86, not the prototype (which adds a Pausable step and drops EIP712 and Nonces).
    expect(spec?.sequence).toEqual([
      "AccessControl", "EmergencyStop", "ERC-165 flags", "GovernedDiamondCut", "ERC20", "ERC4626", "EIP712", "Nonces", "Votes",
      "ERC20Votes", "VaultCore", "TimelockController", "Governor", "GovernedVault",
    ]);
  });
});

// ── templates and routing ──────────────────────────────────────────────────────────────────────────

/** Spec L990: the Blank diamond. Not a Lattice deploy script, so not a catalog template. */
const BLANK = ["DiamondLoupeFacet", "ERC165Facet", "Receive", "AccessControl", "AccessControlDiamondCut"];

describe("templates", () => {
  test("v1: GovernedVault, ERC20 (immutable), SafeDiamondCut; v1.1: Account, Account6900", () => {
    expect(fixture.recipes.map((r) => [r.name, r.phase, r.proxy])).toEqual([
      ["GovernedVault", "v1", "Lattice"],
      ["ERC20", "v1", "Lattice"],
      ["SafeDiamondCut", "v1", "Lattice"],
      ["Account", "v1.1", "AccountDiamond"],
      ["Account6900", "v1.1", "ModularAccount6900"],
    ]);
    expect(template(fixture, "ERC20").immutable).toBe(true);
    expect(template(fixture, "GovernedVault").init).toMatchObject({ kind: "bundle", spec: "GovernedVaultInit" });
    const vaultArgs = template(fixture, "GovernedVault").init;
    expect(vaultArgs.kind === "bundle" && "asset" in (vaultArgs.args["p"] as Record<string, unknown>)).toBe(false);
  });

  test("routed selector counts: GovernedVault 120 of 143, ERC20 15, SafeDiamondCut 29, Blank diamond 12", () => {
    const vault = route(fixture, template(fixture, "GovernedVault"));
    expect([vault.exported, vault.routed.size]).toEqual([143, 120]);
    expect(vault.partial).toEqual(["ERC20", "ERC20Votes", "ERC4626", "VaultCore", "Governor", "Votes"]);
    expect(template(fixture, "GovernedVault").facets).toHaveLength(14);
    expect(route(fixture, template(fixture, "ERC20")).routed.size).toBe(15);
    expect(route(fixture, template(fixture, "SafeDiamondCut")).routed.size).toBe(29);
    const blank = route(fixture, { facets: BLANK, owners: {}, exclude: [] });
    expect([blank.routed.size, blank.unresolved]).toEqual([12, []]);
  });

  test("unmet requirements: only the Blank diamond's EmergencyStop convention (one DEP-02 warning)", () => {
    const unmet = (facets: string[]): string[] =>
      facets.flatMap((name) =>
        facetOf(fixture, name).requires.filter((r) => !r.anyOf.some((a) => facets.includes(a))).map((r) => `${name}:${r.strength}:${r.anyOf.join("|")}`),
      );
    expect(unmet(BLANK)).toEqual(["AccessControlDiamondCut:convention:EmergencyStop"]);
    for (const { name, recipe } of fixture.recipes) expect([name, unmet(recipe.facets)]).toEqual([name, []]);
  });

  const goldens = existsSync(GOLDEN) ? readdirSync(GOLDEN).filter((f) => f.endsWith(".routing.json")) : [];
  test.skipIf(goldens.length === 0)("each template's routing equals golden/expected (GT1's Foundry run)", () => {
    for (const file of goldens) {
      const golden = JSON.parse(readFileSync(join(GOLDEN, file), "utf8")) as { recipe: string; routing: Record<string, string> };
      const routed = Object.fromEntries(route(fixture, template(fixture, golden.recipe)).routed);
      expect([golden.recipe, routed]).toEqual([golden.recipe, golden.routing]);
    }
    expect(goldens.length).toBeGreaterThanOrEqual(3);
  });

  test("seams and default owners alone reproduce GovernedVault's owners", () => {
    const recipe = template(fixture, "GovernedVault");
    expect(route(fixture, { ...recipe, owners: {} }).routed).toEqual(route(fixture, recipe).routed);
  });

  test("the Blank diamond and every v1 template share no ERC-7201 namespace", () => {
    for (const facets of [BLANK, ...["GovernedVault", "ERC20", "SafeDiamondCut"].map((n) => template(fixture, n).facets)]) {
      const ids = facets.flatMap((f) => facetOf(fixture, f).storage?.id ?? []);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

describe("fixture-next, for the migrate flow", () => {
  test("EmergencyStop gains guardianCount() and Governor loses version(), both with new code; ERC20 gets new code; nothing else", () => {
    const changed: string[] = [];
    for (const [i, f] of fixture.facets.entries()) {
      const g = next.facets[i] as Facet;
      expect(g.name).toBe(f.name);
      const { detail: _a, ...fRest } = f;
      const { detail: _b, ...gRest } = g;
      if (JSON.stringify(fRest) !== JSON.stringify(gRest)) changed.push(f.name);
    }
    expect(changed).toEqual(["ERC20", "Governor", "EmergencyStop"]);
    const hexes = (c: Catalog, name: string): string[] => facetOf(c, name).selectors.map((s) => s.hex);
    expect(hexes(next, "EmergencyStop")).toEqual([...hexes(fixture, "EmergencyStop"), toFunctionSelector("function guardianCount()")]);
    expect(hexes(next, "Governor")).toEqual(hexes(fixture, "Governor").filter((h) => h !== toFunctionSelector("function version()")));
    expect(facetOf(next, "ERC20").selectors).toEqual(facetOf(fixture, "ERC20").selectors);
    expect(facetOf(next, "ERC20").release.codehash).not.toBe(facetOf(fixture, "ERC20").release.codehash);
    for (const name of ["ERC20", "Governor", "EmergencyStop"]) {
      const [a, b] = [facetOf(fixture, name).release, facetOf(next, name).release];
      expect([b.salt, b.version]).toEqual([a.salt, a.version]);
      expect([b.codehash === a.codehash, b.initCodeHash === a.initCodeHash, b.address === a.address]).toEqual([false, false, false]);
    }
    expect(next.inits).toEqual(fixture.inits);
    expect(next.seams).toEqual(fixture.seams);
    expect(next.hash).not.toBe(fixture.hash);
  });
});

// ── against Lattice's source at the pin ────────────────────────────────────────────────────────────

describe.skipIf(!lattice)("against Lattice's source at the pin", () => {
  const dir = lattice as string;

  test("the catalog is exactly FacetInventory, in its order (FacetInventory.sol L20-L228)", () => {
    expect(fixture.facets.map((f) => [f.name, f.source])).toEqual(readInventory(dir).map((e) => [e.name, e.path]));
  });

  test("every facet's selectors are its exportSelectors(), in order", () => {
    for (const f of fixture.facets) {
      const exported = readExportSelectors(dir, f.source);
      const expected =
        exported.kind === "hex"
          ? exported.selectors
          : exported.names.map((n) => f.selectors.find((s) => s.signature.startsWith(`${n}(`))?.hex ?? `missing ${n}`);
      expect([f.name, f.selectors.map((s): string => s.hex)]).toEqual([f.name, expected.filter((h) => h !== EXPORT_SELECTORS)]);
    }
  });

  test("GovernedVault: DeployGovernedVault's 14 facets (L77-L92) and exclusions (L117-L167)", () => {
    const cuts = readScriptCuts(dir, "script/base/defi/DeployGovernedVault.s.sol", "_buildBaseCuts");
    expect(cuts.map((c) => c.facet)).toEqual([
      "ERC165Facet", "AccessControl", "TimelockController", "ERC20", "ERC4626", "VaultCore", "Votes", "ERC20Votes", "Governor",
      "GovernedVault", "DiamondLoupeFacet", "EmergencyStop", "GovernedDiamondCut", "Receive",
    ]);
    expect(cuts.filter((c) => c.except.length).map((c) => [c.facet, c.helper, c.except.length])).toEqual([
      ["ERC20", "_erc20Exclusions", 4],
      ["ERC4626", "_erc4626Exclusions", 5],
      ["VaultCore", "_vaultExclusions", 4],
      ["Votes", "_votesExclusions", 4],
      ["ERC20Votes", "_erc20VotesExclusions", 2],
      ["Governor", "_governorExclusions", 4],
    ]);
    const recipe = template(fixture, "GovernedVault");
    expect([...recipe.facets].sort()).toEqual(cuts.map((c) => c.facet).sort());
    const routed = route(fixture, recipe).routed;
    for (const cut of cuts) for (const hex of cut.except) expect([hex, routed.get(hex) === cut.facet]).toEqual([hex, false]);
  });

  test("each template's routing equals its script's cuts", () => {
    const fns: Record<string, string> = { GovernedVault: "_buildBaseCuts", ERC20: "_coreCuts", SafeDiamondCut: "buildCuts", Account: "buildCuts", Account6900: "buildCuts" };
    for (const { name, script, recipe } of fixture.recipes) {
      const fromScript = new Map<Hex4, string>();
      for (const cut of readScriptCuts(dir, script, fns[name] ?? "buildCuts")) {
        for (const { hex } of facetOf(fixture, cut.facet).selectors) if (!cut.except.includes(hex)) fromScript.set(hex, cut.facet);
      }
      expect([name, route(fixture, recipe).routed]).toEqual([name, fromScript]);
    }
  });
});
