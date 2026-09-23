import { describe, expect, test } from "bun:test";
import { createxPredict, factoryPredict } from "../address/diamond";
import type { AnalysisContext, CheckInput, Routing } from "../model/analysis";
import type { Catalog, InitSpec } from "../model/catalog";
import type { ChainState, DeployContext } from "../model/chain";
import type { Hex, Hex4 } from "../model/hex";
import type { Problem } from "../model/problems";
import type { Recipe } from "../model/recipe";
import { renderProblem } from "../narrate/problem";
import { makeCatalog, makeFacet, makeInit, makeRecipe, makeShared } from "../testing/builders";
import { addr, hex } from "../testing/ids";
import { runChecks } from "./index";
import { checkNet, CREATEX_CODEHASH } from "./net";

// Synthetic ChainState for every NET code (spec L335-L342).

function withoutRelease(spec: InitSpec): InitSpec {
  const { release: _, ...rest } = spec;
  return rest;
}

const poseidon = makeShared("PoseidonT3", "0.2.0");
const introspection = makeShared("DiamondIntrospectionInit");
const catalog: Catalog = makeCatalog({
  facets: [
    makeFacet({ name: "DiamondCutFacet", family: "upgrade", selectors: ["diamondCut((address,uint8,bytes4[])[],address,bytes)"] }),
    makeFacet({ name: "DiamondLoupeFacet", selectors: ["facets()", "facetAddresses()"] }),
    makeFacet({ name: "ERC20", selectors: ["transfer(address,uint256)", "balanceOf(address)"] }),
    makeFacet({ name: "ERC20Pausable", selectors: ["transfer(address,uint256)"] }),
    makeFacet({ name: "Semaphore", selectors: ["verifyProof(uint256)"], release: { ...makeShared("Semaphore"), dependsOn: ["PoseidonT3"] } }),
  ],
  inits: [
    makeInit({ name: "MultiInit", fn: "multiInit(address[],bytes[])" }),
    makeInit({ name: "DiamondIntrospectionInit.initUpgradeable", contract: "DiamondIntrospectionInit", fn: "initUpgradeable()", registersInterfaces: true, release: introspection }),
    makeInit({ name: "DiamondIntrospectionInit.initImmutable", contract: "DiamondIntrospectionInit", fn: "initImmutable()", registersInterfaces: true, release: introspection }),
    makeInit({ name: "ERC20Init", fn: "init(string,string)" }),
    makeInit({ name: "SafeDiamondCutInit", fn: "init(address)", registersInterfaces: true }),
    makeInit({ name: "BundleInit", kind: "bundle", fn: "init(address)" }),
    withoutRelease(makeInit({ name: "AccountInit", ctorArgs: [{ name: "entryPoint", type: "address" }] })),
  ],
  libraries: [{ name: "PoseidonT3", release: poseidon }],
});

const transfer: Hex4 = "0xa9059cbb";
const facetOf = (name: string) => {
  const facet = catalog.facets.find((entry) => entry.name === name);
  if (!facet) throw new Error(name);
  return facet;
};

/** Every selector of the placed facets routed to its only exporter; `transfer` to ERC20 when both export it. */
function routingFor(recipe: Recipe): Routing {
  const routing: Routing = {};
  for (const name of recipe.facets) {
    for (const selector of facetOf(name).selectors) {
      const route = routing[selector.hex] ?? { contenders: [], via: "only" as const };
      route.contenders.push(name);
      routing[selector.hex] = route;
    }
  }
  for (const [selector, route] of Object.entries(routing)) {
    const owner = recipe.owners[selector as Hex4] ?? (route.contenders.length === 1 ? route.contenders[0] : undefined);
    if (owner !== undefined) route.owner = owner;
    if (route.contenders.length > 1) route.via = "chosen";
  }
  return routing;
}

const recipe = makeRecipe({
  facets: ["DiamondLoupeFacet", "ERC20", "ERC20Pausable"],
  owners: { [transfer]: "ERC20" },
  init: { kind: "steps", steps: [{ spec: "ERC20Init", args: {} }] },
});

/** The shared contracts `recipe` needs, besides LatticeRegistry and LatticeFactory. */
const NEEDED = ["DiamondLoupeFacet", "ERC20", "MultiInit", "ERC20Init", "DiamondIntrospectionInit"];

const SEPOLIA = 11155111;
const deploy: DeployContext = { chainId: SEPOLIA, path: "factory", from: addr(0xf00d), salt: `${addr(0xf00d).toLowerCase()}00${"11".repeat(11)}` as Hex };

function release(name: string) {
  if (name === "LatticeRegistry") return catalog.registry;
  if (name === "LatticeFactory") return catalog.factory;
  if (name === "PoseidonT3") return poseidon;
  const facet = catalog.facets.find((entry) => entry.name === name);
  if (facet) return facet.release;
  const init = catalog.inits.find((entry) => entry.contract === name);
  if (init?.release) return init.release;
  throw new Error(name);
}

/** A ready chain: every contract present with the catalog's codehash, the pinned versions listed, simulation on. */
function readyChain(overrides: { [K in keyof ChainState]?: ChainState[K] | undefined } = {}, names: readonly string[] = NEEDED): ChainState {
  const shared: ChainState["shared"] = {};
  for (const name of ["LatticeRegistry", "LatticeFactory", ...names]) shared[name] = { present: true, codehash: release(name).codehash };
  const records: NonNullable<ChainState["registry"]>["records"] = {};
  for (const facet of catalog.facets) records[`${facet.name}@${facet.release.version}`] = { facet: facet.release.address, codehash: facet.release.codehash };
  const chain = {
    chainId: SEPOLIA,
    name: "Sepolia",
    online: true,
    probedAt: "2026-09-23T00:00:00.000Z",
    deployer: { present: true, codehash: catalog.deployer.codehash },
    shared,
    registry: { records },
    simulate: true,
    gasCap: "16777216",
    gasEstimate: "4000000",
    codeAt: {},
    predictedHasCode: false,
    ...overrides,
  } as ChainState;
  for (const key of Object.keys(overrides) as (keyof ChainState)[]) if (overrides[key] === undefined) delete chain[key];
  return chain;
}

function run(chain: ChainState | undefined, options: { recipe?: Recipe; deploy?: DeployContext | undefined } = {}): Problem[] {
  const r = options.recipe ?? recipe;
  const d = "deploy" in options ? options.deploy : deploy;
  const ctx: AnalysisContext = { known: [], unconfirmed: [], ...(chain ? { chain } : {}), ...(d ? { deploy: d } : {}) };
  const input: CheckInput = { recipe: r, catalog, routing: routingFor(r), ctx };
  return checkNet(input);
}

function only(problems: Problem[], code: Problem["code"]): Problem {
  const found = problems.filter((entry) => entry.code === code);
  expect(found).toHaveLength(1);
  return found[0] as Problem;
}

function withShared(chain: ChainState, name: string, probe: ChainState["shared"][string]): ChainState {
  return { ...chain, shared: { ...chain.shared, [name]: probe } };
}

describe("when NET checks run (spec L302)", () => {
  test("a ready chain raises nothing", () => {
    expect(run(readyChain())).toEqual([]);
  });

  test("no chain, no deploy context, offline, or probes for another chain: nothing", () => {
    const broken = readyChain({ simulate: false });
    expect(run(broken)).toHaveLength(1);
    expect(run(undefined)).toEqual([]);
    expect(run(broken, { deploy: undefined })).toEqual([]);
    expect(run({ ...broken, online: false })).toEqual([]);
    expect(run({ ...broken, chainId: 1 })).toEqual([]);
  });
});

describe("NET-01 CreateX", () => {
  const createx: DeployContext = { ...deploy, path: "createx" };

  test("missing on the CreateX path", () => {
    const p = only(run(readyChain({ createx: { present: false } }), { deploy: createx }), "NET-01");
    expect(p).toMatchObject({
      id: `NET-01:${SEPOLIA}`,
      severity: "blocker",
      where: [{ kind: "chain", chainId: SEPOLIA }],
      params: { chain: "Sepolia", case: "missing", expected: CREATEX_CODEHASH },
      fixes: [{ id: "deploy.usePath", args: { path: "factory" } }, { id: "chain.focusPicker" }],
    });
  });

  test("another contract at CreateX's address, with the spec's message", () => {
    const actual = hex(0xbad);
    const p = only(run(readyChain({ createx: { present: true, codehash: actual } }), { deploy: createx }), "NET-01");
    expect(p.params).toEqual({ chain: "Sepolia", case: "codehash", expected: CREATEX_CODEHASH, actual });
    expect(renderProblem("NET-01", p.params)).toBe(
      "The contract at CreateX's address on Sepolia isn't CreateX: its codehash differs from 0xbd8a7ea8…b53f.",
    );
  });

  test("the real CreateX, the factory path, or no CreateX probe: nothing", () => {
    expect(run(readyChain({ createx: { present: true, codehash: CREATEX_CODEHASH.toUpperCase().replace("0X", "0x") as Hex } }), { deploy: createx })).toEqual([]);
    expect(run(readyChain({ createx: { present: false } }))).toEqual([]);
    expect(run(readyChain(), { deploy: createx })).toEqual([]);
  });
});

describe("NET-02 and NET-03: missing shared contracts", () => {
  test("LatticeFactory and some facets and init contracts missing (spec example wording)", () => {
    let chain = withShared(readyChain(), "LatticeFactory", { present: false });
    chain = withShared(chain, "ERC20", { present: false });
    chain = withShared(chain, "ERC20Init", { present: false });
    chain = withShared(chain, "DiamondIntrospectionInit", { present: false });
    const p = only(run(chain), "NET-03");
    expect(p).toMatchObject({
      id: `NET-03:${SEPOLIA}`,
      severity: "blocker",
      params: { chain: "Sepolia", core: ["LatticeFactory"], missing: ["ERC20", "ERC20Init", "DiamondIntrospectionInit"], total: 5 },
      fixes: [{ id: "deploy.missingContracts", args: { names: ["LatticeFactory", "ERC20", "ERC20Init", "DiamondIntrospectionInit"] } }],
    });
    expect(renderProblem("NET-03", p.params)).toBe(
      "LatticeFactory and 3 of 5 facets and init contracts aren't on Sepolia yet. Anyone can deploy them at their release addresses.",
    );
  });

  test("only facets the plan cuts count: ERC20Pausable routes nothing, so it isn't needed", () => {
    const chain = withShared(readyChain(), "ERC20Pausable", { present: false });
    expect(run(chain)).toEqual([]);
  });

  test("libraries that placed facets depend on count as missing (PoseidonT3 for Semaphore)", () => {
    const withSemaphore = makeRecipe({ ...recipe, facets: [...recipe.facets, "Semaphore"] });
    const chain = withShared(readyChain({}, [...NEEDED, "Semaphore"]), "PoseidonT3", { present: false });
    const p = only(run(chain, { recipe: withSemaphore }), "NET-03");
    expect(p.params).toMatchObject({ core: [], missing: ["PoseidonT3"], total: 7 });
  });

  test("the automatic ERC-165 step is skipped when a step registers the interfaces itself", () => {
    const safe = makeRecipe({
      facets: ["DiamondCutFacet", "DiamondLoupeFacet"],
      init: { kind: "steps", steps: [{ spec: "SafeDiamondCutInit", args: {} }] },
    });
    const chain = withShared(
      withShared(readyChain({}, ["DiamondCutFacet", "DiamondLoupeFacet", "MultiInit"]), "SafeDiamondCutInit", { present: false }),
      "DiamondIntrospectionInit",
      { present: false },
    );
    expect(only(run(chain, { recipe: safe }), "NET-03").params).toMatchObject({ missing: ["SafeDiamondCutInit"], total: 4 });
  });

  test("a bundle needs its own contract only; inits with constructor arguments aren't shared", () => {
    const bundle = makeRecipe({ facets: ["DiamondLoupeFacet"], init: { kind: "bundle", spec: "BundleInit", args: {} } });
    const chain = withShared(readyChain({}, ["DiamondLoupeFacet"]), "BundleInit", { present: false });
    expect(only(run(chain, { recipe: bundle }), "NET-03").params).toMatchObject({ missing: ["BundleInit"], total: 2 });
    const account = makeRecipe({ facets: ["DiamondLoupeFacet"], init: { kind: "bundle", spec: "AccountInit", args: {} } });
    expect(run(readyChain({}, ["DiamondLoupeFacet"]), { recipe: account })).toEqual([]);
  });

  test("the CreateX path doesn't need LatticeRegistry or LatticeFactory", () => {
    const chain = withShared(withShared(readyChain(), "LatticeRegistry", { present: false }), "LatticeFactory", { present: false });
    expect(run(chain, { deploy: { ...deploy, path: "createx" } })).toEqual([]);
    expect(only(run(chain), "NET-03").params).toMatchObject({ core: ["LatticeRegistry", "LatticeFactory"], missing: [], total: 5 });
  });

  test("a contract the chain module didn't probe is never reported missing", () => {
    const chain = readyChain();
    const { ERC20: _, ...rest } = chain.shared;
    expect(run({ ...chain, shared: rest })).toEqual([]);
  });

  test("NET-02: Arachnid's proxy missing, only when something needs deploying", () => {
    const noProxy = readyChain({ deployer: { present: false } });
    expect(run(noProxy)).toEqual([]);
    const p = only(run(withShared(noProxy, "ERC20", { present: false })), "NET-02");
    expect(p).toMatchObject({
      id: `NET-02:${SEPOLIA}`,
      severity: "blocker",
      params: { chain: "Sepolia", case: "missing", expected: catalog.deployer.codehash },
      fixes: [{ id: "chain.focusPicker" }],
    });
    expect(renderProblem("NET-02", p.params)).toBe(
      "Arachnid's deployment proxy isn't on Sepolia, so missing contracts can't be deployed at their release addresses.",
    );
  });

  test("NET-02: another contract at the proxy's address", () => {
    const actual = hex(0xbeef);
    const chain = withShared(readyChain({ deployer: { present: true, codehash: actual } }), "ERC20", { present: false });
    expect(only(run(chain), "NET-02").params).toEqual({ chain: "Sepolia", case: "codehash", expected: catalog.deployer.codehash, actual });
  });
});

describe("NET-04 code that isn't Lattice's", () => {
  test("a facet's codehash differs: one hard stop, on the chain and the facet", () => {
    const actual = hex(0xdead);
    const erc20 = facetOf("ERC20");
    const p = only(run(withShared(readyChain(), "ERC20", { present: true, codehash: actual })), "NET-04");
    expect(p).toMatchObject({
      id: `NET-04:${SEPOLIA}`,
      severity: "blocker",
      where: [{ kind: "chain", chainId: SEPOLIA }, { kind: "facet", facet: "ERC20" }],
      params: { chain: "Sepolia", name: "ERC20", version: "0.4.0", address: erc20.release.address, expected: erc20.release.codehash, actual },
      fixes: [{ id: "chain.focusPicker" }],
    });
  });

  test("LatticeRegistry drifted: reported before any facet", () => {
    let chain = withShared(readyChain(), "ERC20", { present: true, codehash: hex(1) });
    chain = withShared(chain, "LatticeRegistry", { present: true, codehash: hex(2) });
    expect(only(run(chain), "NET-04").params).toMatchObject({ name: "LatticeRegistry", address: catalog.registry.address });
  });

  test("a chain-specific factory is compared with its own codehash", () => {
    const own = { address: addr(0xfac), codehash: hex(0xfac), buildCommit: "abc", proxyStandardJson: catalog.proxy.standardJson, proxyInitCodeHash: hex(0x1c) };
    const withFactory: Catalog = { ...catalog, chains: [{ chainId: SEPOLIA, factory: own }] };
    const chain = withShared(readyChain(), "LatticeFactory", { present: true, codehash: own.codehash });
    const ctx: AnalysisContext = { known: [], unconfirmed: [], chain, deploy };
    expect(checkNet({ recipe, catalog: withFactory, routing: routingFor(recipe), ctx })).toEqual([]);
    const canonical = withShared(readyChain(), "LatticeFactory", { present: true, codehash: catalog.factory.codehash });
    const drift = checkNet({ recipe, catalog: withFactory, routing: routingFor(recipe), ctx: { ...ctx, chain: canonical } });
    expect(only(drift, "NET-04").params).toMatchObject({ name: "LatticeFactory", address: own.address, expected: own.codehash });
  });
});

describe("NET-05 address already used (spec R8)", () => {
  test("factory path: worded for the factory, at the factory's prediction", () => {
    const p = only(run(readyChain({ predictedHasCode: true })), "NET-05");
    const address = factoryPredict({ factory: catalog.factory.address, proxyInitCodeHash: catalog.proxy.initCodeHash, from: deploy.from, salt: deploy.salt });
    expect(p).toMatchObject({ id: `NET-05:${SEPOLIA}`, severity: "blocker", params: { chain: "Sepolia", path: "factory", address }, fixes: [{ id: "deploy.newSalt" }] });
    expect(renderProblem("NET-05", p.params)).toBe(
      "This account already deployed a diamond with this salt; deploying would return it and ignore this recipe.",
    );
  });

  test("CreateX path: worded for CreateX, at CreateX's prediction", () => {
    const createx: DeployContext = { ...deploy, path: "createx" };
    const p = only(run(readyChain({ predictedHasCode: true }), { deploy: createx }), "NET-05");
    expect(p.params).toEqual({ chain: "Sepolia", path: "createx", address: createxPredict({ from: deploy.from, salt: deploy.salt, chainId: SEPOLIA }) });
    expect(renderProblem("NET-05", p.params)).toBe("This salt was already used on Sepolia; deploying would revert.");
  });
});

describe("NET-06 gas cap (spec R16)", () => {
  test("over the cap: a blocker with the spec's message", () => {
    const p = only(run(readyChain({ gasEstimate: "17200000" })), "NET-06");
    expect(p).toMatchObject({
      id: `NET-06:${SEPOLIA}`,
      severity: "blocker",
      params: { chain: "Sepolia", gas: "17200000", cap: "16777216", share: 1.0252 },
      fixes: [{ id: "deploy.removeFacets" }],
    });
    expect(renderProblem("NET-06", p.params)).toBe("This deploy needs about 17.2M gas; Sepolia allows 16.8M per transaction.");
  });

  test("from 80% up to the cap itself: a warning", () => {
    expect(only(run(readyChain({ gasEstimate: "13421773" })), "NET-06").severity).toBe("warning");
    expect(only(run(readyChain({ gasEstimate: "16777216" })), "NET-06").severity).toBe("warning");
    expect(run(readyChain({ gasEstimate: "13421772" }))).toEqual([]);
  });

  test("no estimate, no cap, or an unreadable one: nothing", () => {
    expect(run(readyChain({ gasEstimate: undefined, gasCap: "100" }))).toEqual([]);
    expect(run(readyChain({ gasCap: undefined, gasEstimate: "99999999" }))).toEqual([]);
    expect(run(readyChain({ gasCap: "0x10", gasEstimate: "99999999" }))).toEqual([]);
  });
});

describe("NET-07 no eth_simulateV1", () => {
  test("info, with Use another RPC", () => {
    const p = only(run(readyChain({ simulate: false })), "NET-07");
    expect(p).toMatchObject({ id: `NET-07:${SEPOLIA}`, severity: "info", params: { chain: "Sepolia" }, fixes: [{ id: "chain.useAnotherRpc" }] });
  });
});

describe("NET-08 registry versions", () => {
  const records = (overrides: Record<string, { facet: Hex; codehash: Hex } | null>) => {
    const chain = readyChain();
    return { ...chain, registry: { records: { ...chain.registry?.records, ...overrides } } };
  };

  test("whole facets the registry doesn't list: a warning to acknowledge", () => {
    const p = only(run(records({ "ERC20@0.4.0": null, "DiamondLoupeFacet@0.4.0": null })), "NET-08");
    const id = `NET-08:${SEPOLIA}`;
    expect(p).toMatchObject({
      id,
      severity: "warning",
      ack: true,
      where: [{ kind: "chain", chainId: SEPOLIA }, { kind: "facet", facet: "DiamondLoupeFacet" }, { kind: "facet", facet: "ERC20" }],
      params: { chain: "Sepolia", facets: ["DiamondLoupeFacet", "ERC20"], count: 2 },
      fixes: [{ id: "ack.set", args: { problemId: id } }, { id: "chain.focusPicker" }],
    });
    expect(renderProblem("NET-08", p.params)).toBe(
      "2 facets will be cut without the registry's on-chain check: Sepolia's LatticeRegistry doesn't list their pinned versions.",
    );
  });

  test("a record for a different facet counts as not listing the pinned one", () => {
    expect(only(run(records({ "ERC20@0.4.0": { facet: addr(1), codehash: hex(1) } })), "NET-08").params).toMatchObject({ facets: ["ERC20"] });
  });

  test("partial facets are custom cuts anyway; unprobed records, the CreateX path and no registry raise nothing", () => {
    const partial = makeRecipe({ ...recipe, exclude: ["0x70a08231"] });
    expect(run(records({ "ERC20@0.4.0": null }), { recipe: partial })).toEqual([]);
    const chain = readyChain();
    expect(run({ ...chain, registry: { records: {} } })).toEqual([]);
    expect(run(records({ "ERC20@0.4.0": null }), { deploy: { ...deploy, path: "createx" } })).toEqual([]);
    expect(run(readyChain({ registry: undefined }))).toEqual([]);
  });
});

test("through runChecks every NET message renders and every id is the chain id", () => {
  let chain = readyChain({ simulate: false, gasEstimate: "17200000", predictedHasCode: true, deployer: { present: false } });
  chain = withShared(chain, "ERC20Init", { present: false });
  chain = withShared(chain, "ERC20", { present: true, codehash: hex(9) });
  chain = { ...chain, registry: { records: { ...chain.registry?.records, "DiamondLoupeFacet@0.4.0": null } } };
  const ctx: AnalysisContext = { known: [], unconfirmed: [], chain, deploy };
  const problems = runChecks({ recipe, catalog, routing: routingFor(recipe), ctx }, [checkNet]);
  expect(problems.map((entry) => entry.code).toSorted()).toEqual(["NET-02", "NET-03", "NET-04", "NET-05", "NET-06", "NET-07", "NET-08"]);
  for (const entry of problems) {
    expect(entry.id).toBe(`${entry.code}:${SEPOLIA}`);
    expect(entry.message.length).toBeGreaterThan(0);
    expect(entry.message).not.toContain("{");
  }
});
