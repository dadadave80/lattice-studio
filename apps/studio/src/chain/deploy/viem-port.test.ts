/**
 * The simulation classifier over a stub EIP-1193 transport: only a refusal of the method itself reads as "can't
 * simulate at all" (spec L575); a rate limit is the RPC not answering (L590), missing funds have their own words
 * (L588), and a revert without data is still a revert.
 */
import { describe, expect, test } from "bun:test";
import type { Address, Hex } from "@lattice-studio/core";
import { createClient, custom, defineChain } from "viem";
import { createViemPort, NOT_ENOUGH_FUNDS } from "./viem-port";

const FROM = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as Address;
const TX = { to: "0x4e59b44847b379578588920cA78FbF26c0B4956C" as Address, data: "0x1234" as Hex, value: 0n };
const CHAIN = defineChain({ id: 11155111, name: "Sepolia", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["http://stub"] } } });

type Failure = { code: number; message: string; data?: Hex };

/** A port whose RPC answers eth_blockNumber and fails `method` as given. */
function port(fail: Partial<Record<"eth_call" | "eth_estimateGas", Failure>>) {
  const client = createClient({
    chain: CHAIN,
    transport: custom({
      async request({ method }: { method: string }) {
        if (method === "eth_blockNumber") return "0x10";
        if (method === "eth_call") {
          if (fail.eth_call) throw Object.assign(new Error(fail.eth_call.message), fail.eth_call);
          return "0x";
        }
        if (method === "eth_estimateGas") {
          if (fail.eth_estimateGas) throw Object.assign(new Error(fail.eth_estimateGas.message), fail.eth_estimateGas);
          return "0x5208";
        }
        throw Object.assign(new Error("unexpected"), { code: -32601 });
      },
    }, { retryCount: 0 }),
  });
  return createViemPort({
    service: {
      chains: () => [{ id: CHAIN.id, name: "Sepolia", testnet: true }],
      probe: async () => ({ ok: false, error: "unused" }),
      codeAt: async () => ({ ok: true, value: "0x" }),
      readFacets: async () => ({ ok: false, error: "unused" }),
      account: () => null,
    },
    client: () => client,
    wallet: {
      send: async () => ({ kind: "rejected" }),
      atomicBatch: async () => false,
      sendCalls: async () => ({ kind: "rejected" }),
      waitCalls: async () => ({ kind: "aborted" }),
    },
    noteEstimate: () => {},
  });
}

const simulate = (p: ReturnType<typeof port>) => p.simulate(CHAIN.id, { from: FROM, tx: TX, simulateV1: false });

describe("simulating without eth_simulateV1", () => {
  test("eth_call and eth_estimateGas both answer: ok, at the block read first", async () => {
    expect(await simulate(port({}))).toEqual({ kind: "ok", block: 16, gas: 21_000n, method: "call" });
  });

  test("the method refused (-32601, -32004) reads as can't simulate at all", async () => {
    expect((await simulate(port({ eth_call: { code: -32601, message: "the method eth_call does not exist/is not available" } }))).kind).toBe("unavailable");
    expect((await simulate(port({ eth_estimateGas: { code: -32004, message: "Method not supported" } }))).kind).toBe("unavailable");
  });

  test("a rate limit (-32005) is the RPC not answering, never can't simulate", async () => {
    expect(await simulate(port({ eth_call: { code: -32005, message: "rate limit exceeded" } }))).toEqual({
      kind: "error", message: "Sepolia's public RPC isn't answering.",
    });
  });

  test("insufficient funds at estimate time has its own words", async () => {
    expect(await simulate(port({ eth_estimateGas: { code: -32000, message: "insufficient funds for gas * price + value" } }))).toEqual({
      kind: "error", message: NOT_ENOUGH_FUNDS,
    });
  });

  test("an execution revert without data at estimate time is a revert", async () => {
    expect(await simulate(port({ eth_estimateGas: { code: -32000, message: "execution reverted" } }))).toMatchObject({ kind: "reverted", block: 16 });
  });

  test("an eth_call revert with data keeps the data", async () => {
    const outcome = await simulate(port({ eth_call: { code: 3, message: "execution reverted", data: "0x08c379a0" } }));
    expect(outcome).toMatchObject({ kind: "reverted", data: "0x08c379a0" });
  });

  test("an internal error from a node a block behind is an error to try again, not can't simulate", async () => {
    const outcome = await simulate(port({ eth_call: { code: -32603, message: "header not found" } }));
    expect(outcome.kind).toBe("error");
  });
});
