import { describe, expect, test } from "bun:test";
import { createClient, custom, defineChain, encodeErrorResult, parseAbi, type EIP1193RequestFn } from "viem";
import { readOnchainCall } from "./call";

const TO = "0x00000000000000000000000000000000000000AA";
const FROM = "0x00000000000000000000000000000000000000bb";
const HASH = `0x${"ab".repeat(32)}` as const;

function client(answer: (method: string, params: readonly unknown[]) => unknown, ccip?: () => Promise<never>) {
  return createClient({
    chain: defineChain({ id: 31337, name: "Anvil", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["http://localhost"] } } }),
    transport: custom({ request: (async ({ method, params }: { method: string; params?: readonly unknown[] }) => answer(method, params ?? [])) as EIP1193RequestFn }, { retryCount: 0 }),
    ...(ccip ? { ccipRead: { request: ccip } } : {}),
  });
}

describe("onchain contract calls", () => {
  test("forwards explicit caller, value and hash pin without changing the client", async () => {
    const calls: { method: string; params: readonly unknown[] }[] = [];
    const rpc = client((method, params) => { calls.push({ method, params }); return method === "eth_chainId" ? "0x7a69" : "0x1234"; });
    expect(await readOnchainCall(rpc, TO, "0xabcdef01", { from: FROM, value: 12n, blockHash: HASH })).toEqual({ ok: true, value: "0x1234" });
    expect(calls.find((call) => call.method === "eth_call")?.params).toEqual([{ from: FROM, to: TO, data: "0xabcdef01", value: "0xc" }, { blockHash: HASH, requireCanonical: true }]);
  });

  test("rejects conflicting pins, negative value and wrong-chain RPC without a call", async () => {
    const calls: string[] = [];
    const rpc = client((method) => { calls.push(method); return "0x1"; });
    expect((await readOnchainCall(rpc, TO, "0x", { block: 1, blockHash: HASH })).ok).toBe(false);
    expect((await readOnchainCall(rpc, TO, "0x", { value: -1n })).ok).toBe(false);
    expect((await readOnchainCall(rpc, TO, "0x")).ok).toBe(false);
    expect(calls).toEqual(["eth_chainId"]);
  });

  test("retains OffchainLookup revert bytes and never invokes contract-directed HTTP", async () => {
    const abi = parseAbi(["error OffchainLookup(address sender, string[] urls, bytes callData, bytes4 callbackFunction, bytes extraData)"]);
    const data = encodeErrorResult({ abi, errorName: "OffchainLookup", args: [TO, ["https://untrusted.example/{data}"], "0x1234", "0x11223344", "0x"] });
    let offchain = 0;
    const request = async (): Promise<never> => { offchain++; throw new Error("Contract-directed HTTP ran."); };
    const rpc = client((method) => {
      if (method === "eth_chainId") return "0x7a69";
      throw Object.assign(new Error("execution reverted"), { code: 3, data });
    }, request);
    const result = await readOnchainCall(rpc, TO, "0x12345678");
    expect(result).toEqual({ ok: false, error: { reason: "The call reverted.", data } });
    expect(offchain).toBe(0);
    expect(rpc.ccipRead).toEqual({ request });
  });

  test("hides provider exception details", async () => {
    const rpc = client(() => { throw new Error("https://private.example/secret-token"); });
    const result = await readOnchainCall(rpc, TO, "0x");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toEqual({ reason: "The RPC couldn't finish the contract call.", data: null });
  });
});
