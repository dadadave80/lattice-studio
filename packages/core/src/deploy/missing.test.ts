import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { concat, decodeFunctionData, keccak256, stringToHex, toFunctionSelector } from "viem";
import { ARACHNID_PROXY, ARACHNID_PROXY_CODEHASH, arachnidAddress } from "../address";
import type { Catalog, SharedContract } from "../model/catalog";
import type { ChainState, MissingDeploysArgs } from "../model/chain";
import type { Hex } from "../model/hex";
import { toChecksum } from "../model/hex";
import { loadFixtureCatalog, makeCatalog, makeFacet, makeInit, makeShard } from "../testing";
import { AGGREGATE3_SELECTOR, MULTICALL3, MULTICALL3_ABI } from "./abi";
import { buildMissingDeploys, MULTICALL3_CALL_OVERHEAD, multicallGas } from "./missing";

/** A shared contract whose creation code is `code`, at the address Arachnid's proxy really gives it. */
function release(name: string, code: Hex, dependsOn?: string[]): SharedContract {
  const salt = keccak256(stringToHex(`lattice.${name}.0.4.0`));
  const initCodeHash = keccak256(code);
  return {
    salt, version: "0.4.0", address: arachnidAddress(salt, initCodeHash), codehash: keccak256(stringToHex(`runtime:${name}`)),
    initCodeHash, creationCode: makeShard(`code/${name}.creation.hex`), ...(dependsOn === undefined ? {} : { dependsOn }),
  };
}

const CODE: Record<string, Hex> = {
  LatticeRegistry: "0x60016000",
  LatticeFactory: "0x60026000",
  PoseidonT3: "0x60036000",
  Semaphore: "0x60046000",
  ERC20: "0x60056000",
  ERC20Init: "0x60066000",
  DiamondIntrospectionInit: "0x60076000",
  OwnableFacet: "0x60086000",
};

const catalog: Catalog = makeCatalog({
  registry: release("LatticeRegistry", CODE.LatticeRegistry ?? "0x"),
  factory: release("LatticeFactory", CODE.LatticeFactory ?? "0x"),
  libraries: [{ name: "PoseidonT3", release: release("PoseidonT3", CODE.PoseidonT3 ?? "0x") }],
  facets: [
    makeFacet({ name: "ERC20", release: release("ERC20", CODE.ERC20 ?? "0x") }),
    makeFacet({ name: "Semaphore", release: release("Semaphore", CODE.Semaphore ?? "0x", ["PoseidonT3"]) }),
    makeFacet({ name: "OwnableFacet", release: release("OwnableFacet", CODE.OwnableFacet ?? "0x") }),
  ],
  inits: [
    makeInit({ name: "ERC20Init", release: release("ERC20Init", CODE.ERC20Init ?? "0x") }),
    makeInit({ name: "DiamondIntrospectionInit.initUpgradeable", contract: "DiamondIntrospectionInit", release: release("DiamondIntrospectionInit", CODE.DiamondIntrospectionInit ?? "0x") }),
    makeInit({ name: "DiamondIntrospectionInit.initImmutable", contract: "DiamondIntrospectionInit", release: release("DiamondIntrospectionInit", CODE.DiamondIntrospectionInit ?? "0x") }),
    makeInit({ name: "PerDiamondInit", ctorArgs: [{ name: "x", type: "uint256" }] }),
  ],
});

/** A modest single-transaction estimate for every contract, so the default cap batches them. */
const ESTIMATES: Record<string, bigint> = Object.fromEntries(Object.keys(CODE).map((name) => [name, 500_000n]));

function chain(over: Partial<ChainState> = {}): ChainState {
  return {
    chainId: 31337, name: "Anvil", online: true, probedAt: "2026-09-23T00:00:00Z",
    deployer: { present: true }, multicall3: { present: true }, shared: {}, simulate: true, codeAt: {},
    ...over,
  };
}

function args(over: Partial<MissingDeploysArgs> = {}): MissingDeploysArgs {
  return {
    catalog, names: ["ERC20", "ERC20Init"], chain: chain(), code: CODE, multicall3Canonical: true,
    gasCap: 30_000_000n, gas: ESTIMATES, ...over,
  };
}

function build(over: Partial<MissingDeploysArgs> = {}) {
  const result = buildMissingDeploys(args(over));
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

const callData = (name: string, contract = catalog.facets.find((f) => f.name === name)?.release) =>
  concat([contract?.salt ?? "0x", CODE[name] ?? "0x"]);

function decodeBatch(data: Hex) {
  const decoded = decodeFunctionData({ abi: MULTICALL3_ABI, data });
  expect(decoded.functionName).toBe("aggregate3");
  return decoded.args[0];
}

describe("Arachnid calls", () => {
  test("aggregate3's selector is the one the ABI encodes", () => {
    expect(toFunctionSelector("aggregate3((address,bool,bytes)[])")).toBe(AGGREGATE3_SELECTOR);
    expect(build({ names: ["ERC20", "OwnableFacet"] }).txs[0]?.tx.data.slice(0, 10)).toBe(AGGREGATE3_SELECTOR);
  });

  test("a single transaction is salt ‖ creationCode to Arachnid's proxy, unencoded", () => {
    const result = build({ names: ["ERC20"], multicall3Canonical: false });
    expect(result).toEqual({
      mode: "transactions",
      txs: [{ tx: { to: ARACHNID_PROXY, data: callData("ERC20"), value: 0n }, names: ["ERC20"] }],
      skipped: [],
    });
  });

  test("LatticeRegistry, LatticeFactory, libraries, facets and inits by name or contract all resolve", () => {
    const names = ["LatticeRegistry", "LatticeFactory", "PoseidonT3", "ERC20", "ERC20Init", "DiamondIntrospectionInit"];
    const result = build({ names, multicall3Canonical: false });
    expect(result.txs.map((t) => t.names)).toEqual(names.map((n) => [n]));
    expect(result.txs[0]?.tx.data).toBe(concat([catalog.registry.salt, CODE.LatticeRegistry ?? "0x"]));
  });

  test("two entry points of one init contract deploy once", () => {
    const result = build({
      names: ["DiamondIntrospectionInit.initUpgradeable", "DiamondIntrospectionInit.initImmutable"],
      code: { DiamondIntrospectionInit: CODE.DiamondIntrospectionInit ?? "0x" },
      multicall3Canonical: false,
    });
    expect(result.txs.map((t) => t.names)).toEqual([["DiamondIntrospectionInit.initUpgradeable"]]);
  });
});

describe("what gets left out", () => {
  test("anything the chain already has is skipped, never sent (EIP-684 would starve the batch)", () => {
    const result = build({ names: ["ERC20", "ERC20Init", "OwnableFacet"], chain: chain({ shared: { ERC20Init: { present: true } } }) });
    expect(result.skipped).toEqual(["ERC20Init"]);
    expect(decodeBatch(result.txs[0]?.tx.data ?? "0x").map((c) => c.callData)).toEqual([callData("ERC20"), callData("OwnableFacet")]);
  });

  test("everything present: nothing to send, everything listed as skipped", () => {
    const result = build({ chain: chain({ shared: { ERC20: { present: true }, ERC20Init: { present: true } } }) });
    expect(result).toEqual({ mode: "transactions", txs: [], skipped: ["ERC20", "ERC20Init"] });
  });
});

describe("dependencies", () => {
  test("PoseidonT3 deploys before Semaphore, and is added when the chain lacks it", () => {
    const listed = build({ names: ["Semaphore", "PoseidonT3"], multicall3Canonical: false });
    expect(listed.txs.map((t) => t.names)).toEqual([["PoseidonT3"], ["Semaphore"]]);
    const unlisted = build({ names: ["ERC20", "Semaphore"], multicall3Canonical: false });
    expect(unlisted.txs.map((t) => t.names)).toEqual([["ERC20"], ["PoseidonT3"], ["Semaphore"]]);
  });

  test("a dependency already on the chain isn't sent again", () => {
    const result = build({ names: ["Semaphore"], chain: chain({ shared: { PoseidonT3: { present: true } } }), multicall3Canonical: false });
    expect(result.txs.map((t) => t.names)).toEqual([["Semaphore"]]);
    expect(result.skipped).toEqual(["PoseidonT3"]);
  });

  test("a dependency the caller didn't load code for is an error, not a silent gap", () => {
    const { PoseidonT3: _, ...code } = CODE;
    expect(buildMissingDeploys(args({ names: ["Semaphore"], code }))).toEqual({
      ok: false, error: "PoseidonT3's creation code isn't loaded. Reload the catalog.",
    });
  });

  test("a cycle is an error", () => {
    const a = release("A", "0x6001", ["B"]);
    const b = release("B", "0x6002", ["A"]);
    const cyclic = { ...catalog, facets: [makeFacet({ name: "A", release: a }), makeFacet({ name: "B", release: b })] };
    expect(buildMissingDeploys(args({ catalog: cyclic, names: ["A"], code: { A: "0x6001", B: "0x6002" } }))).toEqual({
      ok: false, error: "A's dependencies form a cycle. Rebuild the catalog.",
    });
  });
});

describe("batching", () => {
  test("a canonical Multicall3 batches every call with allowFailure", () => {
    const result = build({ names: ["ERC20", "ERC20Init", "OwnableFacet"] });
    expect(result.mode).toBe("multicall");
    expect(result.txs).toHaveLength(1);
    expect(result.txs[0]?.tx.to).toBe(MULTICALL3);
    expect(result.txs[0]?.names).toEqual(["ERC20", "ERC20Init", "OwnableFacet"]);
    const initRelease = catalog.inits.find((i) => i.name === "ERC20Init")?.release;
    expect(decodeBatch(result.txs[0]?.tx.data ?? "0x")).toEqual([
      { target: ARACHNID_PROXY, allowFailure: true, callData: callData("ERC20") },
      { target: ARACHNID_PROXY, allowFailure: true, callData: callData("ERC20Init", initRelease) },
      { target: ARACHNID_PROXY, allowFailure: true, callData: callData("OwnableFacet") },
    ]);
  });

  test("batches split under the gas cap, keeping deploy order", () => {
    const gas = { ERC20: 3_000_000n, ERC20Init: 1_000_000n, OwnableFacet: 2_000_000n, PoseidonT3: 2_500_000n, Semaphore: 2_500_000n };
    const names = ["ERC20", "ERC20Init", "Semaphore", "OwnableFacet"];
    const result = build({ names, gas, gasCap: 6_000_000n });
    expect(result.txs.map((t) => t.names)).toEqual([["ERC20", "ERC20Init"], ["PoseidonT3", "Semaphore"], ["OwnableFacet"]]);
    for (const { tx, names: group } of result.txs) {
      expect(multicallGas(group.map((n) => gas[n as keyof typeof gas]))).toBeLessThanOrEqual(6_000_000n);
      if (group.length === 1) expect(tx.to).toBe(ARACHNID_PROXY);
      else expect(tx.to).toBe(MULTICALL3);
    }
    expect(result.mode).toBe("multicall");
  });

  test("multicallGas adds EIP-150's sixty-third and the per-call overhead", () => {
    expect(multicallGas([])).toBe(0n);
    expect(multicallGas([63n, 126n])).toBe(63n + 1n + 126n + 2n + 2n * MULTICALL3_CALL_OVERHEAD);
  });

  test("a contract without an estimate, or alone over the cap, goes on its own", () => {
    const result = build({ names: ["ERC20", "ERC20Init", "OwnableFacet"], gas: { ERC20: 100_000n, OwnableFacet: 9_000_000n }, gasCap: 5_000_000n });
    expect(result.txs.map((t) => t.names)).toEqual([["ERC20"], ["ERC20Init"], ["OwnableFacet"]]);
    expect(result.txs.every((t) => t.tx.to === ARACHNID_PROXY)).toBe(true);
    expect(result.mode).toBe("transactions");
  });

  test("a non-canonical Multicall3 falls back to one transaction per contract", () => {
    const result = build({ names: ["ERC20", "ERC20Init"], multicall3Canonical: false, gasCap: 30_000_000n });
    expect(result.mode).toBe("transactions");
    expect(result.txs.map((t) => [t.tx.to, t.names])).toEqual([[ARACHNID_PROXY, ["ERC20"]], [ARACHNID_PROXY, ["ERC20Init"]]]);
  });

  test("without a gas cap nothing goes through Multicall3: one transaction each, or one EIP-5792 call list", () => {
    const { gasCap: _, ...uncapped } = args({ names: ["ERC20", "ERC20Init", "OwnableFacet"] });
    const plain = buildMissingDeploys(uncapped);
    if (!plain.ok) throw new Error(plain.error);
    expect(plain.value.mode).toBe("transactions");
    expect(plain.value.txs.map((t) => [t.tx.to, t.names])).toEqual([
      [ARACHNID_PROXY, ["ERC20"]], [ARACHNID_PROXY, ["ERC20Init"]], [ARACHNID_PROXY, ["OwnableFacet"]],
    ]);
    const atomic = buildMissingDeploys({ ...uncapped, atomicCalls: true });
    expect(atomic.ok && atomic.value.mode).toBe("calls");
  });

  test("a canonical Multicall3 that batches nothing falls through to EIP-5792 calls when the wallet has them", () => {
    const over = { names: ["ERC20", "ERC20Init"], gas: { ERC20: 20_000_000n, ERC20Init: 20_000_000n }, atomicCalls: true };
    const result = build(over);
    expect(result.mode).toBe("calls");
    expect(result.txs.map((t) => [t.tx.to, t.names])).toEqual([[ARACHNID_PROXY, ["ERC20"]], [ARACHNID_PROXY, ["ERC20Init"]]]);
    expect(build({ ...over, atomicCalls: false }).mode).toBe("transactions");
  });

  test("Multicall3 missing from the chain falls back too", () => {
    expect(build({ chain: chain({ multicall3: { present: false } }) }).mode).toBe("transactions");
  });

  test("without Multicall3, a wallet with atomic batches gets one EIP-5792 call list", () => {
    const result = build({ names: ["ERC20", "ERC20Init"], multicall3Canonical: false, atomicCalls: true });
    expect(result.mode).toBe("calls");
    expect(result.txs.map((t) => [t.tx.to, t.names])).toEqual([[ARACHNID_PROXY, ["ERC20"]], [ARACHNID_PROXY, ["ERC20Init"]]]);
  });

  test("bytes are deterministic", () => {
    const over = { names: ["ERC20", "Semaphore", "ERC20Init"], gas: { ERC20: 1n, PoseidonT3: 1n, Semaphore: 1n, ERC20Init: 1n }, gasCap: 30_000_000n };
    expect(build(over)).toEqual(build(over));
  });
});

describe("refusals", () => {
  test("a different contract at Arachnid's proxy address (spec L842), when something needs deploying", () => {
    const odd = keccak256(stringToHex("not arachnid"));
    expect(buildMissingDeploys(args({ chain: chain({ deployer: { present: true, codehash: odd } }) }))).toEqual({
      ok: false,
      error: `Anvil has a different contract at Arachnid's deployment proxy address (codehash ${odd}), so shared contracts can't be deployed through it.`,
    });
    const canonical = { present: true, codehash: ARACHNID_PROXY_CODEHASH.toUpperCase().replace("0X", "0x") as Hex };
    expect(buildMissingDeploys(args({ chain: chain({ deployer: canonical }) })).ok).toBe(true);
    const nothing = chain({ deployer: { present: true, codehash: odd }, shared: { ERC20: { present: true }, ERC20Init: { present: true } } });
    expect(buildMissingDeploys(args({ chain: nothing })).ok).toBe(true);
  });

  test("LatticeFactory on a chain with its own factory", () => {
    const own = {
      address: toChecksum(`0x${"fa".repeat(20)}`), codehash: keccak256("0x01"), buildCommit: "a".repeat(40),
      proxyStandardJson: makeShard("json/Factory-31337.standard.json"), proxyInitCodeHash: keccak256("0x02"),
    };
    const withOwn = { ...catalog, chains: [{ chainId: 31337, factory: own }] };
    expect(buildMissingDeploys(args({ catalog: withOwn, names: ["LatticeRegistry", "LatticeFactory"] }))).toEqual({
      ok: false,
      error: `Anvil uses its own LatticeFactory at ${own.address}, which isn't deployed through Arachnid's proxy; the diamond deploy targets it.`,
    });
    expect(buildMissingDeploys(args({ catalog: withOwn, names: ["LatticeRegistry"] })).ok).toBe(true);
    expect(buildMissingDeploys(args({ catalog: withOwn, names: ["LatticeFactory"], chain: chain({ chainId: 1 }) })).ok).toBe(true);
  });

  test("an unknown name, or an init deployed per diamond", () => {
    expect(buildMissingDeploys(args({ names: ["Nope"] }))).toEqual({ ok: false, error: "Nope isn't a shared contract in catalog test." });
    expect(buildMissingDeploys(args({ names: ["PerDiamondInit"] })).ok).toBe(false);
  });

  test("missing or mismatched creation code", () => {
    expect(buildMissingDeploys(args({ code: { ERC20: CODE.ERC20 ?? "0x" } }))).toEqual({
      ok: false, error: "ERC20Init's creation code isn't loaded. Reload the catalog.",
    });
    expect(buildMissingDeploys(args({ code: { ...CODE, ERC20: "0x6000" } }))).toEqual({
      ok: false, error: "ERC20's creation code doesn't match catalog test's init code hash. Reload the catalog.",
    });
  });

  test("a release address Arachnid's proxy wouldn't produce", () => {
    const moved = { ...catalog, registry: { ...catalog.registry, address: toChecksum(`0x${"12".repeat(20)}`) } };
    expect(buildMissingDeploys(args({ catalog: moved, names: ["LatticeRegistry"] }))).toEqual({
      ok: false, error: "LatticeRegistry's release address isn't where Arachnid's proxy would deploy it. Rebuild the catalog.",
    });
  });

  test("a chain without Arachnid's proxy, when something needs deploying", () => {
    expect(buildMissingDeploys(args({ chain: chain({ deployer: { present: false } }) }))).toEqual({
      ok: false, error: "Arachnid's deployment proxy isn't on Anvil, so shared contracts can't be deployed there.",
    });
    const nothing = buildMissingDeploys(args({ chain: chain({ deployer: { present: false }, shared: { ERC20: { present: true }, ERC20Init: { present: true } } }) }));
    expect(nothing.ok).toBe(true);
  });
});

describe("with the fixture catalog", () => {
  const fixture = loadFixtureCatalog();
  if (!fixture.ok) throw new Error(fixture.error);
  const cat = fixture.value;
  const read = (name: string) => readFileSync(new URL(`../../../../fixtures/catalog/fixture/code/${name}.creation.hex`, import.meta.url), "utf8").trim() as Hex;

  test("real dependsOn: PoseidonT3 first, then Semaphore and ShieldedPool, each hash-checked", () => {
    const names = ["Semaphore", "ShieldedPool", "LatticeRegistry", "LatticeFactory"];
    const code = Object.fromEntries([...names, "PoseidonT3"].map((name) => [name, read(name)]));
    const gas = Object.fromEntries([...names, "PoseidonT3"].map((name) => [name, 500_000n]));
    const result = buildMissingDeploys({ catalog: cat, names, chain: chain(), code, multicall3Canonical: true, gasCap: 16_777_216n, gas });
    if (!result.ok) throw new Error(result.error);
    expect(result.value.txs.flatMap((t) => t.names)).toEqual(["PoseidonT3", "Semaphore", "ShieldedPool", "LatticeRegistry", "LatticeFactory"]);
    const calls = decodeBatch(result.value.txs[0]?.tx.data ?? "0x");
    expect(calls[0]?.callData).toBe(concat([cat.libraries?.[0]?.release.salt ?? "0x", code.PoseidonT3 ?? "0x"]));
  });
});
