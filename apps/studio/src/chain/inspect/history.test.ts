import { describe, expect, test } from "bun:test";
import { createClient, custom, defineChain, encodeAbiParameters, encodeEventTopics, keccak256, parseAbiItem, type EIP1193RequestFn } from "viem";
import { LATTICE_FACTORY_ABI, type Hex } from "@lattice-studio/core";
import { makeCatalog } from "@lattice-studio/core/testing";
import { readCutHistory } from "./history";

const TARGET = "0x00000000000000000000000000000000000000AA";
const FACET = "0x00000000000000000000000000000000000000bb";
const ZERO = "0x0000000000000000000000000000000000000000";
const CUT = parseAbiItem("event DiamondCut((address facetAddress, uint8 action, bytes4[] functionSelectors)[] _diamondCut, address _init, bytes _calldata)");
const hash = (block: number): Hex => `0x${block.toString(16).padStart(64, "0")}`;

function log(block = 2, index = 0) {
  return {
    address: TARGET, blockNumber: `0x${block.toString(16)}`, blockHash: hash(block), transactionHash: hash(100 + block),
    transactionIndex: "0x0", logIndex: `0x${index.toString(16)}`, removed: false,
    topics: encodeEventTopics({ abi: [CUT], eventName: "DiamondCut" }),
    data: encodeAbiParameters(CUT.inputs, [[{ facetAddress: FACET, action: 0, functionSelectors: ["0x12345678"] }], ZERO, "0x"]),
  };
}

function rpc(logs = [log()]) {
  const calls: { method: string; params: readonly unknown[] }[] = [];
  const state = { maxRange: 10_000, chainId: 11155111, reorg: false, headers: 0, abort: null as AbortController | null,
    receipt: null as Record<string, unknown> | null, transaction: null as Record<string, unknown> | null, code: "0x6001",
    headerGate: null as ((number: number) => Promise<void> | undefined) | null };
  const client = createClient({
    chain: defineChain({ id: 11155111, name: "Sepolia", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["http://localhost"] } } }),
    transport: custom({ request: (async ({ method, params }: { method: string; params?: readonly unknown[] }) => {
      calls.push({ method, params: params ?? [] });
      if (method === "eth_chainId") return `0x${state.chainId.toString(16)}`;
      if (method === "eth_getBlockByNumber") {
        const number = Number(BigInt(String(params?.[0])));
        state.headers++;
        await state.headerGate?.(number);
        return { number: params?.[0], hash: state.reorg && state.headers > 1 && number === 5 ? hash(99) : hash(number), timestamp: "0x1", gasLimit: "0x1000000", transactions: [] };
      }
      if (method === "eth_getLogs") {
        const query = params?.[0] as { fromBlock: string; toBlock: string };
        const from = Number(BigInt(query.fromBlock)); const to = Number(BigInt(query.toBlock));
        if (to - from + 1 > state.maxRange) throw Object.assign(new Error("block range limit exceeded"), { code: -32000 });
        state.abort?.abort();
        return logs.filter((item) => Number(BigInt(item.blockNumber)) >= from && Number(BigInt(item.blockNumber)) <= to);
      }
      if (method === "eth_getTransactionReceipt") return state.receipt;
      if (method === "eth_getTransactionByHash") return state.transaction;
      if (method === "eth_getCode") return state.code;
      throw new Error("https://private.example/secret-token");
    }) as EIP1193RequestFn }, { retryCount: 0 }),
  });
  return { client, calls, state };
}

function creationReceipt(r: ReturnType<typeof rpc>) {
  r.state.receipt = { transactionHash: hash(102), transactionIndex: "0x0", blockHash: hash(2), blockNumber: "0x2", from: FACET, to: null, cumulativeGasUsed: "0x1", gasUsed: "0x1", contractAddress: TARGET, logs: [log()], status: "0x1", effectiveGasPrice: "0x1", type: "0x0" };
  r.state.transaction = { hash: hash(102), nonce: "0x0", blockHash: hash(2), blockNumber: "0x2", transactionIndex: "0x0", from: FACET, to: null, value: "0x0", gas: "0x100000", gasPrice: "0x1", input: "0x6000", type: "0x0", v: "0x1b", r: hash(1), s: hash(1) };
}

describe("cut history transport", () => {
  test("strictly decodes ordered cuts, deduplicates repeats and labels partial coverage honestly", async () => {
    const r = rpc([log(4), log(2), log(2)]);
    const result = await readCutHistory(r.client, TARGET, { fromBlock: 1, toBlock: 5, blockHash: hash(5) });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.reason);
    expect(result.value.history.map((event) => event.block)).toEqual([2, 4]);
    expect(result.value.history[0]?.cuts).toEqual([{ facet: FACET, action: "add", selectors: ["0x12345678"] }]);
    expect(result.value.coverage).toBe("range");
    expect(result.value.deployment).toBeNull();
    const request = r.calls.find((call) => call.method === "eth_getLogs")?.params[0] as { address: string; topics: Hex[] };
    expect(request.address).toBe(TARGET);
    expect(JSON.stringify(request.topics)).toBe(JSON.stringify(encodeEventTopics({ abi: [CUT], eventName: "DiamondCut" })));
  });

  test("a genesis scan alone cannot invent deployment from its earliest event", async () => {
    const r = rpc();
    const result = await readCutHistory(r.client, TARGET, { fromBlock: 0, toBlock: 5, blockHash: hash(5) });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.reason);
    expect(result.value.coverage).toBe("full");
    expect(result.value.deployment).toBeNull();
  });

  test("creation provenance requires an actual creation receipt, not an ordinary diamond call", async () => {
    const r = rpc(); creationReceipt(r);
    const created = await readCutHistory(r.client, TARGET, { fromBlock: 0, toBlock: 5, blockHash: hash(5) });
    expect(created.ok).toBe(true);
    if (!created.ok) throw new Error(created.error.reason);
    expect(created.value.deployment).toMatchObject({ txHash: hash(102), block: 2, via: "other", to: null });
    r.state.receipt!.contractAddress = null;
    r.state.transaction!.to = TARGET;
    const upgraded = await readCutHistory(r.client, TARGET, { fromBlock: 0, toBlock: 5, blockHash: hash(5) });
    if (!upgraded.ok) throw new Error(upgraded.error.reason);
    expect(upgraded.value.deployment).toBeNull();
  });

  test("a known factory event proves deployment only with matching historical runtime code", async () => {
    const r = rpc(); creationReceipt(r);
    const base = makeCatalog(); const catalog = { ...base, factory: { ...base.factory, codehash: keccak256("0x6001") } };
    const factoryLog = { ...log(2, 1), address: catalog.factory.address,
      topics: encodeEventTopics({ abi: LATTICE_FACTORY_ABI, eventName: "DiamondDeployed", args: { diamond: TARGET, deployer: FACET, recipeHash: hash(1) } }),
      data: encodeAbiParameters([{ type: "bytes32" }, { type: "address" }], [hash(1), ZERO]),
    };
    r.state.receipt!.contractAddress = null;
    r.state.receipt!.logs = [log(), factoryLog];
    r.state.transaction!.to = catalog.factory.address;
    const valid = await readCutHistory(r.client, TARGET, { fromBlock: 0, toBlock: 5, blockHash: hash(5) }, { catalogs: [catalog] });
    if (!valid.ok) throw new Error(valid.error.reason);
    expect(valid.value.deployment?.via).toBe("LatticeFactory");
    r.state.code = "0x6002";
    const spoofed = await readCutHistory(r.client, TARGET, { fromBlock: 0, toBlock: 5, blockHash: hash(5) }, { catalogs: [catalog] });
    if (!spoofed.ok) throw new Error(spoofed.error.reason);
    expect(spoofed.value.deployment).toBeNull();
  });

  test("halves provider-refused ranges without gaps and stops at its request budget", async () => {
    const r = rpc([log(2), log(4)]); r.state.maxRange = 2;
    const result = await readCutHistory(r.client, TARGET, { fromBlock: 0, toBlock: 5, blockHash: hash(5) }, { initialWindow: 8 });
    expect(result.ok).toBe(true);
    const limited = await readCutHistory(r.client, TARGET, { fromBlock: 0, toBlock: 5, blockHash: hash(5) }, { initialWindow: 1, maxRequests: 2 });
    expect(limited.ok).toBe(false);
    if (!limited.ok) expect(limited.error.kind).toBe("limit");
  });

  test("event/header budgets fail without publishing truncated history", async () => {
    for (const limits of [{ maxLogs: 1 }, { maxHeaders: 1 }]) {
      const r = rpc([log(2), log(4)]);
      const result = await readCutHistory(r.client, TARGET, { fromBlock: 0, toBlock: 5, blockHash: hash(5) }, limits);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("limit");
    }
  });

  test("bounds header verification to four requests and abort stops queued work", async () => {
    const r = rpc(Array.from({ length: 12 }, (_, index) => log(index + 1)));
    const releases: (() => void)[] = [];
    r.state.headerGate = (number) => number === 20 ? undefined : new Promise<void>((resolve) => { releases.push(resolve); });
    const abort = new AbortController();
    const reading = readCutHistory(r.client, TARGET, { fromBlock: 0, toBlock: 20, blockHash: hash(20), signal: abort.signal });
    for (let i = 0; i < 40; i++) await Promise.resolve();
    expect(releases).toHaveLength(4);
    abort.abort();
    for (const release of releases) release();
    const result = await reading;
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("aborted");
    expect(r.state.headers).toBe(5);
  });

  test("an unavailable event header stops queued verification and hides provider details", async () => {
    const r = rpc(Array.from({ length: 12 }, (_, index) => log(index + 1)));
    const releases: (() => void)[] = [];
    r.state.headerGate = (number) => number === 20 ? undefined : number === 1
      ? Promise.reject(new Error("https://private.example/secret-token"))
      : new Promise<void>((resolve) => { releases.push(resolve); });
    const reading = readCutHistory(r.client, TARGET, { fromBlock: 0, toBlock: 20, blockHash: hash(20) });
    for (let i = 0; i < 60; i++) await Promise.resolve();
    for (const release of releases) release();
    const result = await reading;
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("secret-token");
    expect(r.state.headers).toBe(5);
  });

  test.each([
    { fromBlock: -1, toBlock: 5, blockHash: hash(5) },
    { fromBlock: 6, toBlock: 5, blockHash: hash(5) },
    { fromBlock: 0, toBlock: Number.MAX_SAFE_INTEGER + 1, blockHash: hash(5) },
  ])("invalid ranges never reach RPC", async (options) => {
    const r = rpc();
    expect((await readCutHistory(r.client, TARGET, options)).ok).toBe(false);
    expect(r.calls).toEqual([]);
  });

  test("removed, malformed and conflicting duplicate logs fail instead of fabricating events", async () => {
    for (const logs of [[{ ...log(), removed: true }], [{ ...log(), data: "0x1234" as Hex }], [log(), { ...log(), transactionHash: hash(999) }]]) {
      const r = rpc(logs);
      const result = await readCutHistory(r.client, TARGET, { fromBlock: 0, toBlock: 5, blockHash: hash(5) });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("invalid");
    }
  });

  test("cancellation and a changed target hash never publish partial history", async () => {
    const r = rpc(); const abort = new AbortController(); r.state.abort = abort;
    const stopped = await readCutHistory(r.client, TARGET, { fromBlock: 0, toBlock: 5, blockHash: hash(5), signal: abort.signal });
    expect(stopped.ok).toBe(false);
    if (!stopped.ok) expect(stopped.error.kind).toBe("aborted");
    const changed = rpc(); changed.state.reorg = true;
    const reorg = await readCutHistory(changed.client, TARGET, { fromBlock: 0, toBlock: 5, blockHash: hash(5) });
    expect(reorg.ok).toBe(false);
    if (!reorg.ok) expect(reorg.error.kind).toBe("reorg");
  });
});
