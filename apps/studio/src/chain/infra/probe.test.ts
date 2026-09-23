import { describe, expect, test } from "bun:test";
import type { Address, Catalog, ChainState, Hex, Problem } from "@lattice-studio/core";
import { analyze, buildSalt, MULTICALL3 } from "@lattice-studio/core";
import { makeRecipe } from "@lattice-studio/core/testing";
import { keccak256 } from "viem";
import { CREATEX_CODEHASH as HARNESS_CREATEX, MULTICALL3_CODEHASH as HARNESS_MULTICALL3 } from "../../../test/harness/chain";
import { ANVIL, BASE_SEPOLIA, SEPOLIA, type ChainSpec } from "./chains";
import { createClients } from "./clients";
import {
  CODEHASH_PROGRAM, CREATEX_CODEHASH, EMPTY_CODEHASH, MULTICALL3_CODEHASH, probeChain, readCodehashes,
} from "./probe";
import { fixtureCatalog, healthyAccounts, listedRecords, mockChain, type MockChain, type MockChainOptions } from "./testing";

const catalog = fixtureCatalog();
const FROM = "0x1111111111111111111111111111111111111111" as Address;

/** The NET problems core raises for `facets` with these probes, on the factory path. */
function netProblems(facets: string[], chain: ChainState): Problem[] {
  const salt = buildSalt(FROM, "every-chain", `0x${"00".repeat(11)}` as Hex);
  const recipe = makeRecipe({ facets }, catalog);
  const analysis = analyze(recipe, catalog, { known: [], unconfirmed: [], chain, deploy: { chainId: chain.chainId, path: "factory", from: FROM, salt } });
  return analysis.problems.filter((p) => p.code.startsWith("NET-"));
}
const PROBED_AT = "2026-09-23T12:00:00.000Z";

function setup(options: Partial<MockChainOptions> & { spec?: ChainSpec } = {}): { chain: MockChain; probe: (codeAt?: Address[], using?: Catalog) => Promise<ChainState & { createx: ChainState["deployer"] }> } {
  const spec = options.spec ?? SEPOLIA;
  const chain = mockChain({ chainId: spec.id, accounts: healthyAccounts(catalog), records: listedRecords(catalog), ...options });
  const clients = createClients({ overrides: () => ({}), transport: () => chain.transport(), rank: false });
  return {
    chain,
    probe: (codeAt = [], using = catalog) =>
      probeChain(clients.get(spec), {
        chainId: spec.id,
        name: spec.name,
        catalog: using,
        ...(spec.gasCap !== undefined ? { gasCap: spec.gasCap } : {}),
        codeAt,
        online: true,
        probedAt: () => PROBED_AT,
      }),
  };
}

describe("constants", () => {
  test("match C6's NET-01 constant and the harness's fakes", () => {
    expect(CREATEX_CODEHASH).toBe(HARNESS_CREATEX);
    expect(MULTICALL3_CODEHASH).toBe(HARNESS_MULTICALL3);
    expect(CREATEX_CODEHASH.slice(0, 10)).toBe("0xbd8a7ea8");
    expect(CREATEX_CODEHASH.slice(-4)).toBe("b53f");
  });

  test("the codehash program is 37 bytes and jumps to its own JUMPDESTs", () => {
    expect((CODEHASH_PROGRAM.length - 2) / 2).toBe(0x25);
    const bytes = CODEHASH_PROGRAM.slice(2).match(/../g) ?? [];
    expect(bytes[0x0d]).toBe("5b");
    expect(bytes[0x20]).toBe("5b");
    expect(bytes.slice(1, 3).join("")).toBe("0025");
  });
});

describe("probeChain", () => {
  test("a healthy chain: every shared contract present with its codehash, records listed, simulate, the EIP-7825 cap", async () => {
    const { chain, probe } = setup();
    const state = await probe();
    expect(state.chainId).toBe(SEPOLIA.id);
    expect(state.name).toBe("Sepolia");
    expect(state.probedAt).toBe(PROBED_AT);
    expect(state.online).toBe(true);
    expect(state.deployer).toEqual({ present: true, codehash: catalog.deployer.codehash });
    expect(state.multicall3).toEqual({ present: true, codehash: MULTICALL3_CODEHASH });
    expect(state.createx).toEqual({ present: true, codehash: CREATEX_CODEHASH });
    expect(state.shared.LatticeRegistry).toEqual({ present: true, codehash: catalog.registry.codehash });
    expect(state.shared.LatticeFactory).toEqual({ present: true, codehash: catalog.factory.codehash });
    for (const facet of catalog.facets) expect(state.shared[facet.name]).toEqual({ present: true, codehash: facet.release.codehash });
    for (const init of catalog.inits.filter((i) => i.release)) {
      expect(state.shared[init.contract]?.present).toBe(true);
      expect(state.shared[init.name]?.present).toBe(true);
    }
    for (const library of catalog.libraries ?? []) expect(state.shared[library.name]?.present).toBe(true);
    const erc20 = catalog.facets.find((f) => f.name === "ERC20");
    expect(erc20).toBeDefined();
    expect(state.registry?.records[`ERC20@${erc20?.release.version}`]).toEqual({
      facet: erc20?.release.address as Address,
      codehash: erc20?.release.codehash.toLowerCase() as `0x${string}`,
    });
    expect(state.simulate).toBe(true);
    expect(state.gasCap).toBe("16777216");
    expect(state.codeAt).toEqual({});
    // One call for every codehash, and the registry through Multicall3 (its codehash is canonical).
    const calls = chain.calls.filter((c) => c.method === "eth_call");
    const programCalls = calls.filter((c) => !(c.params as [{ to?: string }])[0].to);
    const multicalls = calls.filter((c) => (c.params as [{ to?: string }])[0].to?.toLowerCase() === MULTICALL3.toLowerCase());
    expect(programCalls).toHaveLength(1);
    expect(multicalls.length).toBeGreaterThan(0);
    expect(chain.methods()).not.toContain("eth_getCode");
  });

  test("missing contracts read as absent, and core's NET-03 names them", async () => {
    const { probe } = setup({ accounts: healthyAccounts(catalog, ["ERC20", "LatticeFactory"]) });
    const state = await probe();
    expect(state.shared.ERC20).toEqual({ present: false });
    expect(state.shared.LatticeFactory).toEqual({ present: false });
    const net03 = netProblems(["DiamondCutFacet", "DiamondLoupeFacet", "ERC20"], state).find((p) => p.code === "NET-03");
    expect(net03?.params).toMatchObject({ core: ["LatticeFactory"], missing: ["ERC20"] });
  });

  test("a registry that doesn't list a pinned version reads as null, and core's NET-08 names the facet", async () => {
    const { probe } = setup({ records: listedRecords(catalog, ["ERC20"]) });
    const state = await probe();
    const version = catalog.facets.find((f) => f.name === "ERC20")?.release.version;
    expect(state.registry?.records[`ERC20@${version}`]).toBeNull();
    const net08 = netProblems(["DiamondCutFacet", "DiamondLoupeFacet", "ERC20"], state).find((p) => p.code === "NET-08");
    expect(net08?.params).toMatchObject({ facets: ["ERC20"] });
  });

  test("without Multicall3's canonical code, records come from separate calls", async () => {
    const accounts = healthyAccounts(catalog);
    accounts[MULTICALL3.toLowerCase()] = { code: "0x60", codehash: `0x${"99".repeat(32)}` };
    const { chain, probe } = setup({ accounts, records: listedRecords(catalog, ["ERC20"]) });
    const state = await probe();
    expect(state.multicall3).toEqual({ present: true, codehash: `0x${"99".repeat(32)}` });
    const tos = chain.calls.filter((c) => c.method === "eth_call").map((c) => (c.params as [{ to?: string }])[0].to?.toLowerCase());
    expect(tos).not.toContain(MULTICALL3.toLowerCase());
    expect(tos.filter((to) => to === catalog.registry.address.toLowerCase()).length).toBeGreaterThan(10);
    const version = catalog.facets.find((f) => f.name === "ERC20")?.release.version;
    expect(state.registry?.records[`ERC20@${version}`]).toBeNull();
    expect(Object.values(state.registry?.records ?? {}).filter((r) => r !== null).length).toBe(catalog.facets.length - 1);
  });

  test("no registry, or a registry with other code: no records are claimed", async () => {
    const absent = setup({ accounts: healthyAccounts(catalog, ["LatticeRegistry"]) });
    expect((await absent.probe()).registry).toBeUndefined();
    const accounts = healthyAccounts(catalog);
    accounts[catalog.registry.address.toLowerCase()] = { code: "0x05", codehash: `0x${"77".repeat(32)}` };
    const drifted = setup({ accounts });
    const state = await drifted.probe();
    expect(state.registry).toBeUndefined();
    expect(state.shared.LatticeRegistry).toEqual({ present: true, codehash: `0x${"77".repeat(32)}` });
  });

  test("an RPC that rejects calls without `to` falls back to eth_getCode", async () => {
    const accounts = healthyAccounts(catalog);
    const erc20 = catalog.facets.find((f) => f.name === "ERC20");
    if (!erc20) throw new Error("fixture has ERC20");
    // Real code this time, so keccak(code) is the codehash the fallback computes.
    accounts[erc20.release.address.toLowerCase()] = { code: "0x6001600155" };
    const { chain, probe } = setup({ accounts, deployless: false });
    const state = await probe();
    expect(chain.methods()).toContain("eth_getCode");
    expect(state.shared.ERC20?.present).toBe(true);
    expect(state.shared.ERC20?.codehash).toBe(keccak256("0x6001600155"));
    expect(state.shared.ERC20?.codehash).not.toBe(erc20.release.codehash);
  });

  test("eth_simulateV1 missing reads as false (NET-07)", async () => {
    const { probe } = setup({ simulate: false });
    expect((await probe()).simulate).toBe(false);
  });

  test("a chain without a fixed cap uses the latest block's gasLimit", async () => {
    const { probe } = setup({ spec: BASE_SEPOLIA, gasLimit: 60_000_000n });
    expect((await probe()).gasCap).toBe("60000000");
    const anvil = setup({ spec: ANVIL, gasLimit: 30_000_000n });
    expect((await anvil.probe()).gasCap).toBe("30000000");
  });

  test("a chain-specific LatticeFactory is probed at its own address", async () => {
    const own = "0x00000000000000000000000000000000000fac70" as Address;
    const withOwn: Catalog = {
      ...catalog,
      chains: [...catalog.chains, { chainId: SEPOLIA.id, factory: { address: own, codehash: `0x${"42".repeat(32)}`, buildCommit: "abc", proxyStandardJson: catalog.proxy.standardJson, proxyInitCodeHash: catalog.proxy.initCodeHash } }],
    };
    const accounts = healthyAccounts(catalog, ["LatticeFactory"]);
    accounts[own] = { code: "0x06", codehash: `0x${"42".repeat(32)}` };
    const { probe } = setup({ accounts });
    expect((await probe([], withOwn)).shared.LatticeFactory).toEqual({ present: true, codehash: `0x${"42".repeat(32)}` });
  });

  test("code at the addresses asked about, keyed lowercase", async () => {
    const safe = "0x71C7656EC7ab88b098defB751B7401B5f6d8976F" as Address;
    const { probe } = setup({ accounts: { ...healthyAccounts(catalog), [safe.toLowerCase()]: { code: "0xfeed" } } });
    const nobody = "0x000000000000000000000000000000000000dEaD" as Address;
    const state = await probe([safe, nobody]);
    expect(state.codeAt).toEqual({ [safe.toLowerCase()]: "0xfeed", [nobody.toLowerCase()]: "0x" });
  });

  test("a failing RPC fails the probe", async () => {
    const { chain, probe } = setup();
    chain.down = true;
    await expect(probe()).rejects.toThrow();
  });
});

describe("readCodehashes", () => {
  test("empty accounts and unknown addresses read as no code", async () => {
    const funded = "0x1111111111111111111111111111111111111111" as Address;
    const chain = mockChain({ chainId: 1, accounts: { [funded]: { code: "0x", balance: 1n } } });
    const clients = createClients({ overrides: () => ({}), transport: () => chain.transport(), rank: false });
    const hashes = await readCodehashes(clients.get(SEPOLIA), [funded, "0x2222222222222222222222222222222222222222"]);
    expect(hashes).toEqual([null, null]);
    expect(EMPTY_CODEHASH).toBe("0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
  });
});
