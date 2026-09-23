import { describe, expect, test } from "bun:test";
import { decodeFunctionData, keccak256, stringToHex, toFunctionSelector } from "viem";
import { buildSalt, CREATEX, createxPredict, factoryPredict } from "../address";
import { computeRouting } from "../analysis";
import { encodeInit } from "../init/encode";
import { planInit } from "../init/plan";
import type { PlanEntry } from "../model/analysis";
import type { Catalog } from "../model/catalog";
import type { ChainState, DiamondDeployArgs } from "../model/chain";
import type { Address, Hex } from "../model/hex";
import type { Recipe } from "../model/recipe";
import { buildPlan, loadTemplate } from "../plan";
import { addr, loadFixtureCatalog, makeCatalog, makeFacet, makeRecipe } from "../testing";
import {
  CREATEX_ABI, CREATEX_DEPLOY_SELECTOR, FACTORY_DEPLOY_SELECTOR, LATTICE_FACTORY_ABI, LATTICE_INITIALIZE_ABI,
} from "./abi";
import { buildDiamondDeploy, packVersion, registryNameHash } from "./diamond";

const ALICE: Address = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"; // Anvil account 0
const BOB: Address = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"; // Anvil account 1
const ENTROPY: Hex = "0x0102030405060708090a0b";
const PROXY_CODE: Hex = "0x6080604052348015600e575f5ffd5b50";
const INIT = { target: addr(0x1234), data: "0xe1c7392a" as Hex };

const loupe = makeFacet({
  name: "DiamondLoupeFacet",
  selectors: ["facets()", "facetFunctionSelectors(address)", "facetAddresses()", "facetAddress(bytes4)"],
});
const erc20 = makeFacet({ name: "ERC20", selectors: ["transfer(address,uint256)", "approve(address,uint256)", "totalSupply()"] });
const catalog: Catalog = makeCatalog({
  facets: [loupe, erc20],
  proxy: {
    creationCode: { path: "code/Lattice.creation.hex", bytes: 16, hash: keccak256(PROXY_CODE) },
    initCodeHash: keccak256(PROXY_CODE),
    standardJson: { path: "json/Lattice.standard.json", bytes: 0, hash: keccak256("0x00") },
  },
});

function entry(facet: typeof loupe, selectors = facet.selectors.map((s) => s.hex)): PlanEntry {
  return { facet: facet.name, address: facet.release.address, codehash: facet.release.codehash, version: facet.release.version, selectors };
}

const PLAN: PlanEntry[] = [entry(loupe), entry(erc20)];

function chain(records: NonNullable<ChainState["registry"]>["records"]): ChainState {
  return {
    chainId: 31337, name: "Anvil", online: true, probedAt: "2026-09-23T00:00:00Z",
    deployer: { present: true }, shared: {}, simulate: true, codeAt: {}, registry: { records },
  };
}

const listed = (facet: typeof loupe) => ({ facet: facet.release.address, codehash: facet.release.codehash });

function args(over: Partial<DiamondDeployArgs> = {}): DiamondDeployArgs {
  return {
    recipe: makeRecipe({ facets: ["DiamondLoupeFacet", "ERC20"] }),
    catalog, plan: PLAN, init: INIT, path: "factory", from: ALICE,
    salt: buildSalt(ALICE, "every-chain", ENTROPY), chainId: 31337,
    ...over,
  };
}

function build(over: Partial<DiamondDeployArgs> = {}) {
  const result = buildDiamondDeploy(args(over));
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

function decodeFactory(data: Hex) {
  const decoded = decodeFunctionData({ abi: LATTICE_FACTORY_ABI, data });
  expect(decoded.functionName).toBe("deploy");
  const [entries, cuts, init, initCalldata, salt] = decoded.args as readonly [
    readonly { nameHash: Hex; version: bigint }[], readonly { facetAddress: Address; action: number; functionSelectors: readonly Hex[] }[],
    Address, Hex, Hex,
  ];
  return { entries, cuts, init, initCalldata, salt };
}

describe("selectors", () => {
  test("the ABIs carry the signatures the brief names", () => {
    expect(toFunctionSelector("deploy((bytes32,uint64)[],(address,uint8,bytes4[])[],address,bytes,bytes32)")).toBe(FACTORY_DEPLOY_SELECTOR);
    expect(toFunctionSelector("deployCreate3AndInit(bytes32,bytes,bytes,(uint256,uint256))")).toBe(CREATEX_DEPLOY_SELECTOR);
    expect(build().tx.data.slice(0, 10)).toBe(FACTORY_DEPLOY_SELECTOR);
    expect(build({ path: "createx", proxyCreationCode: PROXY_CODE }).tx.data.slice(0, 10)).toBe(CREATEX_DEPLOY_SELECTOR);
  });
});

describe("versions and names", () => {
  test("packVersion packs major<<48 | minor<<24 | patch and never returns 0", () => {
    expect(packVersion("0.4.0")).toBe(67108864n);
    expect(packVersion("1.2.3")).toBe((1n << 48n) | (2n << 24n) | 3n);
    expect(packVersion("0.0.0")).toBeNull();
    expect(packVersion("0.4")).toBeNull();
    expect(packVersion("v0.4.0")).toBeNull();
    expect(packVersion("65536.0.0")).toBeNull();
    expect(packVersion("0.16777216.0")).toBeNull();
  });

  test("registryNameHash is keccak256(\"lattice.<Name>\")", () => {
    expect(registryNameHash("ERC20")).toBe(keccak256(stringToHex("lattice.ERC20")));
  });
});

describe("factory path", () => {
  test("decodes to custom cuts, the init and the raw salt when the chain has no registry records", () => {
    const deploy = build();
    const salt = buildSalt(ALICE, "every-chain", ENTROPY);
    expect(deploy.tx.to).toBe(catalog.factory.address);
    expect(deploy.tx.value).toBe(0n);
    expect(deploy.address).toBe(factoryPredict({ factory: catalog.factory.address, proxyInitCodeHash: catalog.proxy.initCodeHash, from: ALICE, salt }));
    const decoded = decodeFactory(deploy.tx.data);
    expect(decoded.entries).toEqual([]);
    expect(decoded.cuts).toEqual([
      { facetAddress: loupe.release.address, action: 0, functionSelectors: loupe.selectors.map((s) => s.hex) },
      { facetAddress: erc20.release.address, action: 0, functionSelectors: erc20.selectors.map((s) => s.hex) },
    ]);
    expect(decoded.init).toBe(INIT.target);
    expect(decoded.initCalldata).toBe(INIT.data);
    expect(decoded.salt).toBe(salt);
    expect(deploy.registryEntries).toEqual([]);
    expect(deploy.customCuts).toEqual(["DiamondLoupeFacet", "ERC20"]);
  });

  test("a whole facet the registry lists with the catalog's address and codehash goes as a RecipeEntry", () => {
    const deploy = build({ chain: chain({ "ERC20@0.4.0": listed(erc20), "DiamondLoupeFacet@0.4.0": null }) });
    const decoded = decodeFactory(deploy.tx.data);
    expect(decoded.entries).toEqual([{ nameHash: keccak256(stringToHex("lattice.ERC20")), version: 67108864n }]);
    expect(decoded.cuts.map((cut) => cut.facetAddress)).toEqual([loupe.release.address]);
    expect(deploy.registryEntries).toEqual(["ERC20"]);
    expect(deploy.customCuts).toEqual(["DiamondLoupeFacet"]);
  });

  test("record addresses compare case-insensitively", () => {
    const record = { facet: erc20.release.address.toLowerCase() as Address, codehash: erc20.release.codehash };
    expect(build({ chain: chain({ "ERC20@0.4.0": record }) }).registryEntries).toEqual(["ERC20"]);
  });

  const custom: [string, Parameters<typeof chain>[0], PlanEntry[]][] = [
    ["the record's codehash differs", { "ERC20@0.4.0": { facet: erc20.release.address, codehash: keccak256("0xdead") } }, PLAN],
    ["the record's address differs", { "ERC20@0.4.0": { facet: addr(0xbeef), codehash: erc20.release.codehash } }, PLAN],
    ["the registry doesn't list the version", { "ERC20@0.4.0": null }, PLAN],
    ["the registry lists another version only", { "ERC20@0.3.0": listed(erc20) }, PLAN],
    ["the facet is partial", { "ERC20@0.4.0": listed(erc20) }, [entry(loupe), entry(erc20, erc20.selectors.slice(0, 2).map((s) => s.hex))]],
  ];
  test.each(custom)("a facet goes as a custom cut when %s", (_, records, plan) => {
    const deploy = build({ chain: chain(records), plan });
    expect(deploy.registryEntries).toEqual([]);
    expect(deploy.customCuts).toEqual(["DiamondLoupeFacet", "ERC20"]);
    expect(decodeFactory(deploy.tx.data).entries).toEqual([]);
  });

  test("a 0.0.0 release is never sent as version 0 (\"latest\")", () => {
    const zero = makeFacet({ ...erc20, selectors: erc20.selectors, release: { ...erc20.release, version: "0.0.0" } });
    const cat = { ...catalog, facets: [loupe, zero] };
    const deploy = build({ catalog: cat, plan: [entry(loupe), entry(zero)], chain: chain({ "ERC20@0.0.0": listed(zero) }) });
    expect(deploy.registryEntries).toEqual([]);
    expect(decodeFactory(deploy.tx.data).entries.every((e) => e.version !== 0n)).toBe(true);
  });

  test("a chain-specific factory replaces the release factory, with its own proxy init code hash", () => {
    const own = {
      address: addr(0xfac), codehash: keccak256("0x01"), buildCommit: "a".repeat(40),
      proxyStandardJson: catalog.proxy.standardJson, proxyInitCodeHash: keccak256("0x02"),
    };
    const cat = { ...catalog, chains: [{ chainId: 11155111, factory: own }] };
    const salt = buildSalt(ALICE, "every-chain", ENTROPY);
    const there = build({ catalog: cat, chainId: 11155111 });
    expect(there.tx.to).toBe(own.address);
    expect(there.address).toBe(factoryPredict({ factory: own.address, proxyInitCodeHash: own.proxyInitCodeHash, from: ALICE, salt }));
    expect(build({ catalog: cat }).tx.to).toBe(catalog.factory.address);
  });

  test("bytes are deterministic", () => {
    const records = { "ERC20@0.4.0": listed(erc20) };
    expect(build({ chain: chain(records) })).toEqual(build({ chain: chain(records) }));
    expect(build({ path: "createx", proxyCreationCode: PROXY_CODE })).toEqual(build({ path: "createx", proxyCreationCode: PROXY_CODE }));
  });
});

describe("CreateX path", () => {
  test("carries the raw sender-prefixed salt, the Lattice creation code and initialize(cuts, init, data)", () => {
    for (const scope of ["every-chain", "this-chain"] as const) {
      const salt = buildSalt(ALICE, scope, ENTROPY);
      const deploy = build({ path: "createx", salt, proxyCreationCode: PROXY_CODE, chain: chain({ "ERC20@0.4.0": listed(erc20) }) });
      expect(deploy.tx).toMatchObject({ to: CREATEX, value: 0n });
      expect(deploy.address).toBe(createxPredict({ from: ALICE, salt, chainId: 31337 }));
      const outer = decodeFunctionData({ abi: CREATEX_ABI, data: deploy.tx.data });
      const [rawSalt, initCode, data, values] = outer.args;
      expect(rawSalt).toBe(salt);
      expect(rawSalt.slice(0, 42)).toBe(ALICE.toLowerCase());
      expect(initCode).toBe(PROXY_CODE);
      expect(values).toEqual({ constructorAmount: 0n, initCallAmount: 0n });
      const inner = decodeFunctionData({ abi: LATTICE_INITIALIZE_ABI, data });
      expect(inner.args).toEqual([
        [
          { facetAddress: loupe.release.address, action: 0, functionSelectors: loupe.selectors.map((s) => s.hex) },
          { facetAddress: erc20.release.address, action: 0, functionSelectors: erc20.selectors.map((s) => s.hex) },
        ],
        INIT.target,
        INIT.data,
      ]);
      expect(deploy.registryEntries).toEqual([]);
      expect(deploy.customCuts).toEqual(["DiamondLoupeFacet", "ERC20"]);
    }
  });

  test("the prediction differs per chain only for the this-chain scope", () => {
    const every = buildSalt(ALICE, "every-chain", ENTROPY);
    const here = buildSalt(ALICE, "this-chain", ENTROPY);
    const at = (salt: Hex, chainId: number) => build({ path: "createx", salt, chainId, proxyCreationCode: PROXY_CODE }).address;
    expect(at(every, 1)).toBe(at(every, 10));
    expect(at(here, 1)).not.toBe(at(here, 10));
  });

  test("refuses missing or mismatched Lattice creation code", () => {
    expect(buildDiamondDeploy(args({ path: "createx" }))).toEqual({
      ok: false, error: "The Lattice proxy's creation code isn't loaded; the CreateX path needs it. Reload the catalog.",
    });
    const wrong = buildDiamondDeploy(args({ path: "createx", proxyCreationCode: "0x6080" }));
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.error).toContain("doesn't match catalog test's init code hash");
  });

  test("the factory path doesn't need the creation code", () => {
    expect(buildDiamondDeploy(args()).ok).toBe(true);
  });
});

describe("refusals", () => {
  test("a salt that doesn't start with the sending account", () => {
    for (const path of ["factory", "createx"] as const) {
      const result = buildDiamondDeploy(args({ path, from: BOB, proxyCreationCode: PROXY_CODE }));
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("not the sending account");
    }
  });

  test("a salt with a scope byte CreateX rejects", () => {
    const salt = `${ALICE.toLowerCase()}02${ENTROPY.slice(2)}` as Hex;
    const result = buildDiamondDeploy(args({ path: "createx", salt, proxyCreationCode: PROXY_CODE }));
    expect(result).toEqual({ ok: false, error: "The salt's scope byte is 0x02; it must be 0x00 or 0x01." });
  });

  test("an empty plan", () => {
    expect(buildDiamondDeploy(args({ plan: [] }))).toEqual({
      ok: false, error: "The diamond has no facets to cut; LatticeFactory reverts EmptyRecipe. Place facets first.",
    });
  });

  test("a plan entry that differs from the catalog release, isn't placed, or carries exportSelectors()", () => {
    const moved = buildDiamondDeploy(args({ plan: [entry(loupe), { ...entry(erc20), address: addr(0xbad) }] }));
    expect(moved).toEqual({ ok: false, error: "ERC20 in the plan differs from its test release. Rebuild the plan." });
    const unplaced = buildDiamondDeploy(args({ recipe: makeRecipe({ facets: ["DiamondLoupeFacet"] }) }));
    expect(unplaced).toEqual({ ok: false, error: "ERC20 is in the plan but not on the sheet. Rebuild the plan." });
    const exported = buildDiamondDeploy(args({ plan: [entry(loupe), entry(erc20, ["0x0ef22643"])] }));
    expect(exported.ok).toBe(false);
  });

  test("an init target that isn't an address", () => {
    const result = buildDiamondDeploy(args({ init: { target: "0x1234", data: "0x" } }));
    expect(result).toEqual({ ok: false, error: "The init target 0x1234 isn't an address." });
  });
});

/** Templates leave a few arguments for the person to fill in (INIT-01); fill them the way the sheet would. */
function fillRequired(recipe: Recipe): void {
  if (recipe.init.kind === "bundle") {
    const p = recipe.init.args["p"];
    if (p !== undefined && typeof p === "object" && !Array.isArray(p) && !("$ref" in p)) p["asset"] = BOB;
  }
  if (recipe.init.kind === "steps") {
    for (const step of recipe.init.steps) if (step.spec === "SafeDiamondCutInit") step.args["safe"] = BOB;
  }
}

describe("with the fixture catalog", () => {
  const fixture = loadFixtureCatalog();
  if (!fixture.ok) throw new Error(fixture.error);
  const cat = fixture.value;

  test.each(["ERC20", "SafeDiamondCut", "GovernedVault"])("%s template: plan and C4b's init reach the factory call intact", (name) => {
    const recipe = loadTemplate(cat, name);
    if (!recipe.ok) throw new Error(recipe.error);
    fillRequired(recipe.value);
    const { entries: plan } = buildPlan(recipe.value, cat, computeRouting(recipe.value, cat));
    const salt = buildSalt(ALICE, "every-chain", ENTROPY);
    const refs = { self: factoryPredict({ factory: cat.factory.address, proxyInitCodeHash: cat.proxy.initCodeHash, from: ALICE, salt }), deployer: ALICE };
    const init = encodeInit(planInit(recipe.value, cat), cat, refs);
    if (!init.ok) throw new Error(init.error);
    const records = Object.fromEntries(plan.map((e) => [`${e.facet}@${e.version}`, { facet: e.address, codehash: e.codehash }]));
    const result = buildDiamondDeploy({ recipe: recipe.value, catalog: cat, plan, init: init.value, path: "factory", from: ALICE, salt, chainId: 31337, chain: chain(records) });
    if (!result.ok) throw new Error(result.error);
    expect(result.value.address).toBe(refs.self);
    const decoded = decodeFactory(result.value.tx.data);
    expect(decoded.init).toBe(init.value.target);
    expect(decoded.initCalldata).toBe(init.value.data);
    const whole = plan.filter((e) => e.selectors.length === cat.facets.find((f) => f.name === e.facet)?.selectors.length);
    expect(result.value.registryEntries).toEqual(whole.map((e) => e.facet));
    expect(decoded.entries.map((e) => e.nameHash)).toEqual(whole.map((e) => registryNameHash(e.facet)));
    expect(decoded.cuts.map((c) => c.facetAddress)).toEqual(plan.filter((e) => !whole.includes(e)).map((e) => e.address));
    expect(result.value.registryEntries.length + result.value.customCuts.length).toBe(plan.length);
  });
});
