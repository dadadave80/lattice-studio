import { describe, expect, test } from "bun:test";
import type { Address, Hex, LoupeFacet } from "@lattice-studio/core";
import { addr, hex, sel } from "@lattice-studio/core/testing";
import { createClient, custom, encodeErrorResult, encodeFunctionResult, HttpRequestError, keccak256, numberToHex, parseAbi } from "viem";
import { sepolia } from "viem/chains";
import type { ChainClient } from "../infra/clients";
import { readDiamondSnapshot } from "./reads";

const A = addr(10);
const B = addr(11);
const C = addr(12);
const D = addr(13);
const HASH = hex(1);
const OWNER = "0x8da5cb5b";
const FACETS = "0x7a0ed627";
const ABI = parseAbi([
  "function facets() view returns ((address facetAddress, bytes4[] functionSelectors)[])",
  "function owner() view returns (address)",
]);

type Request = { method: string; params: readonly unknown[] };
type RpcOptions = {
  facets?: readonly LoupeFacet[];
  handle?: (request: Request, next: () => unknown) => unknown | Promise<unknown>;
};

const row = (facetAddress: Address, functionSelectors: readonly Hex[]): LoupeFacet => ({ facetAddress, functionSelectors });

function block(hash = HASH) {
  return { number: "0x2a", hash, timestamp: "0x1", gasLimit: "0x1000000", gasUsed: "0x0", transactions: [] };
}

function gate() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

function rpc(options: RpcOptions = {}): { client: ChainClient; requests: Request[] } {
  const requests: Request[] = [];
  const facets = options.facets ?? [row(A, [sel(1), OWNER]), row(B, [sel(2)]), row(D, [sel(3)])];
  const code: Record<string, Hex> = { [D.toLowerCase()]: "0x6000", [A.toLowerCase()]: "0x6001", [B.toLowerCase()]: "0x6002" };
  const client = createClient({
    chain: sepolia,
    cacheTime: 0,
    transport: custom({
      request: async ({ method, params }) => {
        const request = { method, params: (params ?? []) as readonly unknown[] };
        requests.push(request);
        const next = (): unknown => {
          if (method === "eth_chainId") return numberToHex(sepolia.id);
          if (method === "eth_getBlockByNumber") return block();
          if (method === "eth_getCode") return code[String(request.params[0]).toLowerCase()] ?? "0x";
          if (method === "eth_call") {
            const call = request.params[0] as { data?: string };
            if (call.data === FACETS) return encodeFunctionResult({ abi: ABI, functionName: "facets", result: facets });
            if (call.data === OWNER) return encodeFunctionResult({ abi: ABI, functionName: "owner", result: C });
          }
          throw new Error(`Unexpected RPC method ${method}.`);
        };
        return options.handle ? options.handle(request, next) : next();
      },
    }, { retryCount: 0 }),
  });
  return { client, requests };
}

describe("readDiamondSnapshot", () => {
  test("pins code, loupe, facet code and owner to one canonical hash and verifies it again", async () => {
    const source = rpc();
    const result = await readDiamondSnapshot(source.client, D);
    expect(result).toEqual({ ok: true, value: {
      block: 42,
      blockHash: HASH,
      code: "0x6000",
      facets: [row(A, [sel(1), OWNER]), row(B, [sel(2)]), row(D, [sel(3)])],
      codehashes: { [A.toLowerCase()]: keccak256("0x6001"), [B.toLowerCase()]: keccak256("0x6002") },
      ownerRouted: true,
      owner: C,
    } });
    const pinned = source.requests.filter((request) => ["eth_call", "eth_getCode"].includes(request.method));
    expect(pinned).toHaveLength(5);
    for (const request of pinned) expect(request.params[1]).toEqual({ blockHash: HASH, requireCanonical: true });
    expect(source.requests.filter((request) => request.method === "eth_getBlockByNumber").map((request) => request.params[0])).toEqual(["latest", "0x2a"]);
    expect(source.requests.filter((request) => request.method === "eth_chainId")).toHaveLength(2);
    expect(source.requests.filter((request) => request.method === "eth_getCode" && request.params[0] === D)).toHaveLength(1);
  });

  test("no code is an observed state and makes no loupe or owner calls", async () => {
    const source = rpc({ handle: (request, next) => request.method === "eth_getCode" ? "0x" : next() });
    const result = await readDiamondSnapshot(source.client, D);
    expect(result).toEqual({ ok: true, value: {
      block: 42, blockHash: HASH, code: "0x", facets: null, codehashes: {}, ownerRouted: false, owner: null,
    } });
    expect(source.requests.some((request) => request.method === "eth_call")).toBe(false);
  });

  test("a missing owner selector is valid and does not call owner", async () => {
    const source = rpc({ facets: [row(A, [sel(1)])] });
    const result = await readDiamondSnapshot(source.client, D);
    expect(result.ok && result.value.ownerRouted).toBe(false);
    expect(result.ok && result.value.owner).toBeNull();
    expect(source.requests.filter((request) => request.method === "eth_call")).toHaveLength(1);
  });

  test("empty loupe returndata is not a transport error or a fabricated empty loupe", async () => {
    const source = rpc({ handle: (request, next) => request.method === "eth_call" ? "0x" : next() });
    const result = await readDiamondSnapshot(source.client, D);
    expect(result.ok && result.value.facets).toBeNull();
    expect(result.ok && result.value.loupeError).toEqual({ kind: "invalid-response", reason: "facets() returned no data.", data: "0x" });
  });

  test("a reverting loupe remains not-a-diamond with its raw revert bytes", async () => {
    const source = rpc({ handle: (request, next) => {
      if (request.method === "eth_call") throw { code: 3, message: "execution reverted", data: "0xdeadbeef" };
      return next();
    } });
    const result = await readDiamondSnapshot(source.client, D);
    expect(result.ok && result.value.facets).toBeNull();
    expect(result.ok && result.value.loupeError).toEqual({ kind: "reverted", reason: "facets() reverted.", data: "0xdeadbeef" });
  });

  test("does not follow a loupe's OffchainLookup URLs or mutate the shared client's ENS policy", async () => {
    const revert = encodeErrorResult({
      abi: parseAbi(["error OffchainLookup(address sender, string[] urls, bytes callData, bytes4 callbackFunction, bytes extraData)"]),
      errorName: "OffchainLookup",
      args: [D, ["https://contract-chosen.example/{data}"], "0x", "0x12345678", "0x"],
    });
    const source = rpc({ handle: (request, next) => {
      if (request.method === "eth_call") throw { code: 3, message: "execution reverted", data: revert };
      return next();
    } });
    let offchainRequests = 0;
    const ccipRead = { request: async () => { offchainRequests += 1; throw new Error("Contract-directed HTTP isn't part of a snapshot."); } };
    const client = { ...source.client, ccipRead };
    const result = await readDiamondSnapshot(client, D);
    expect(offchainRequests).toBe(0);
    expect(client.ccipRead).toBe(ccipRead);
    expect(result.ok && result.value.loupeError?.data).toBe(revert);
  });

  test("a transport failure reading the loupe stays an RPC failure without exposing endpoint secrets", async () => {
    const source = rpc({ handle: (request, next) => {
      if (request.method === "eth_call") throw new HttpRequestError({ url: "https://private.example/rpc?key=secret-token", status: 503 });
      return next();
    } });
    const result = await readDiamondSnapshot(source.client, D);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.kind).toBe("rpc");
    expect(JSON.stringify(result)).not.toContain("secret-token");
    expect(JSON.stringify(result)).not.toContain("private.example");
  });

  test("unsupported hash-pinned requests fail explicitly without trying latest or number state reads", async () => {
    const source = rpc({ handle: (request, next) => {
      if (request.method === "eth_getCode") throw { code: -32602, message: "block hash objects unsupported" };
      return next();
    } });
    const result = await readDiamondSnapshot(source.client, D);
    expect(!result.ok && result.error.kind).toBe("rpc");
    const codeCalls = source.requests.filter((request) => request.method === "eth_getCode");
    expect(codeCalls).toHaveLength(1);
    expect(codeCalls[0]?.params[1]).toEqual({ blockHash: HASH, requireCanonical: true });
  });

  test("a routed but reverting owner is unreadable, not absent, with raw revert data", async () => {
    const source = rpc({ handle: (request, next) => {
      if (request.method === "eth_call" && (request.params[0] as { data?: string }).data === OWNER) {
        throw { code: 3, message: "execution reverted", data: "0xdeadbeef" };
      }
      return next();
    } });
    const result = await readDiamondSnapshot(source.client, D);
    expect(result.ok && result.value.ownerRouted).toBe(true);
    expect(result.ok && result.value.owner).toBeNull();
    expect(result.ok && result.value.ownerError).toEqual({ kind: "reverted", reason: "owner() reverted.", data: "0xdeadbeef" });
  });

  test("a malformed routed owner result stays visibly unreadable", async () => {
    const source = rpc({ handle: (request, next) => request.method === "eth_call" && (request.params[0] as { data?: string }).data === OWNER ? "0x1234" : next() });
    const result = await readDiamondSnapshot(source.client, D);
    expect(result.ok && result.value.ownerRouted).toBe(true);
    expect(result.ok && result.value.owner).toBeNull();
    expect(result.ok && result.value.ownerError).toEqual({ kind: "invalid-response", reason: "owner() returned malformed data.", data: "0x1234" });
  });

  test("a zero owner is a successfully read renounced owner", async () => {
    const source = rpc({ handle: (request, next) => request.method === "eth_call" && (request.params[0] as { data?: string }).data === OWNER
      ? encodeFunctionResult({ abi: ABI, functionName: "owner", result: addr(0) }) : next() });
    const result = await readDiamondSnapshot(source.client, D);
    expect(result.ok && result.value.owner).toBe(addr(0));
    expect(result.ok && result.value.ownerError).toBeUndefined();
  });

  test("an unavailable routed owner fails the snapshot instead of pretending authority was read", async () => {
    const source = rpc({ handle: (request, next) => {
      if (request.method === "eth_call" && (request.params[0] as { data?: string }).data === OWNER) throw new HttpRequestError({ url: "https://down.example", status: 503 });
      return next();
    } });
    const result = await readDiamondSnapshot(source.client, D);
    expect(!result.ok && result.error.kind).toBe("rpc");
  });
});

describe("snapshot validation and consistency", () => {
  for (const facets of [
    [row(A, [sel(1)]), row(A, [sel(2)])],
    [row(A, [sel(1)]), row(B, [sel(1)])],
    [row(A, [sel(1), sel(1)])],
    [row(addr(0), [sel(1)])],
    [row(A, [])],
  ]) {
    test(`refuses malformed loupe rows ${JSON.stringify(facets)}`, async () => {
      const source = rpc({ facets });
      const result = await readDiamondSnapshot(source.client, D);
      expect(!result.ok && result.error.kind).toBe("invalid");
    });
  }

  test("nonempty malformed ABI is rejected instead of being an empty loupe", async () => {
    const source = rpc({ handle: (request, next) => request.method === "eth_call" ? "0x1234" : next() });
    const result = await readDiamondSnapshot(source.client, D);
    expect(!result.ok && result.error.kind).toBe("invalid");
  });

  test("missing facet code fails rather than classifying an unread facet as unknown", async () => {
    const source = rpc({ handle: (request, next) => request.method === "eth_getCode" && request.params[0] === A ? "0x" : next() });
    const result = await readDiamondSnapshot(source.client, D);
    expect(!result.ok && result.error.kind).toBe("invalid");
  });

  test("facet code RPC failure fails instead of publishing a partial codehash map", async () => {
    const source = rpc({ handle: (request, next) => {
      if (request.method === "eth_getCode" && request.params[0] === A) throw new HttpRequestError({ url: "https://down.example", status: 503 });
      return next();
    } });
    const result = await readDiamondSnapshot(source.client, D);
    expect(!result.ok && result.error.kind).toBe("rpc");
  });

  for (const invalid of [null, "0x0", "not hex"]) {
    test(`rejects malformed runtime code ${String(invalid)}`, async () => {
      const source = rpc({ handle: (request, next) => request.method === "eth_getCode" ? invalid : next() });
      const result = await readDiamondSnapshot(source.client, D);
      expect(!result.ok && result.error.kind).toBe("invalid");
    });
  }

  test("wrong chain is rejected before any code reads", async () => {
    const source = rpc({ handle: (request, next) => request.method === "eth_chainId" ? "0x1" : next() });
    const result = await readDiamondSnapshot(source.client, D);
    expect(!result.ok && result.error.kind).toBe("chain");
    expect(source.requests.some((request) => request.method === "eth_getCode")).toBe(false);
  });

  test("a changed chain at the end is rejected", async () => {
    let chainReads = 0;
    const source = rpc({ handle: (request, next) => request.method === "eth_chainId" && ++chainReads > 1 ? "0x1" : next() });
    const result = await readDiamondSnapshot(source.client, D);
    expect(!result.ok && result.error.kind).toBe("chain");
  });

  test("a changed canonical hash rejects the whole snapshot", async () => {
    const source = rpc({ handle: (request, next) => request.method === "eth_getBlockByNumber" && request.params[0] !== "latest" ? block(hex(2)) : next() });
    const result = await readDiamondSnapshot(source.client, D);
    expect(!result.ok && result.error.kind).toBe("reorg");
  });

  for (const invalid of [
    { ...block(), hash: null },
    { ...block(), number: null },
    { ...block(), hash: "0x1234" },
    { ...block(), number: "0x20000000000000" },
  ]) {
    test("refuses an incomplete or unsafe snapshot block", async () => {
      const source = rpc({ handle: (request, next) => request.method === "eth_getBlockByNumber" ? invalid : next() });
      const result = await readDiamondSnapshot(source.client, D);
      expect(!result.ok && result.error.kind).toBe("invalid");
    });
  }

  test("invalid addresses are refused without touching the RPC", async () => {
    const source = rpc();
    const result = await readDiamondSnapshot(source.client, "0x1234");
    expect(!result.ok && result.error.kind).toBe("invalid");
    expect(source.requests).toHaveLength(0);
  });
});

describe("bounded work and cancellation", () => {
  test("keeps at most four facet code reads in flight for a large loupe", async () => {
    const facets = Array.from({ length: 24 }, (_, index) => row(addr(100 + index), [sel(index + 1)]));
    const release = gate();
    const started = gate();
    let inFlight = 0;
    let maximum = 0;
    let calls = 0;
    const source = rpc({ facets, handle: async (request, next) => {
      if (request.method !== "eth_getCode" || request.params[0] === D) return next();
      calls += 1;
      maximum = Math.max(maximum, ++inFlight);
      if (calls === 4) started.release();
      await release.promise;
      inFlight -= 1;
      return "0x6001";
    } });
    const reading = readDiamondSnapshot(source.client, D);
    try {
      await started.promise;
      expect(calls).toBe(4);
      expect(inFlight).toBe(4);
    } finally {
      release.release();
    }
    const result = await reading;
    expect(result.ok).toBe(true);
    expect(maximum).toBe(4);
    expect(calls).toBe(24);
    expect(result.ok && Object.keys(result.value.codehashes)).toHaveLength(24);
  });

  test("abort stops queued reads and never returns a partial snapshot", async () => {
    const facets = Array.from({ length: 24 }, (_, index) => row(addr(100 + index), [sel(index + 1)]));
    const release = gate();
    const started = gate();
    const controller = new AbortController();
    let calls = 0;
    const source = rpc({ facets, handle: async (request, next) => {
      if (request.method !== "eth_getCode" || request.params[0] === D) return next();
      if (++calls === 4) started.release();
      await release.promise;
      return "0x6001";
    } });
    const reading = readDiamondSnapshot(source.client, D, controller.signal);
    await started.promise;
    controller.abort();
    release.release();
    const result = await reading;
    expect(!result.ok && result.error.kind).toBe("aborted");
    expect(calls).toBe(4);
  });

  test("an already aborted read touches no RPC", async () => {
    const source = rpc();
    const controller = new AbortController();
    controller.abort();
    const result = await readDiamondSnapshot(source.client, D, controller.signal);
    expect(!result.ok && result.error.kind).toBe("aborted");
    expect(source.requests).toHaveLength(0);
  });
});
