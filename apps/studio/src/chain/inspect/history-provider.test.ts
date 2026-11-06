import { afterEach, describe, expect, test } from "bun:test";
import { createClient, custom, defineChain } from "viem";
import { readHistory, supportsHyperRpc } from "./history-provider";

const ADDRESS = "0x00000000000000000000000000000000000000AA";
const HASH = `0x${"ab".repeat(32)}` as const;
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
function client(chainId = 11155111) {
  let calls = 0;
  const rpc = createClient({ chain: defineChain({ id: chainId, name: "Test", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["https://arbitrary-user-rpc.example"] } } }),
    transport: custom({ request: async () => { calls++; throw new Error("The user RPC shouldn't receive a token."); } }, { retryCount: 0 }),
  });
  return { rpc, calls: () => calls };
}

describe("HyperRPC credential boundary", () => {
  test("uses only an allowlisted host with one encoded token segment and rejects redirects/referrers", async () => {
    const r = client();
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      const body = JSON.parse(String(init?.body)) as { id: number; method: string };
      const result = body.method === "eth_chainId" ? "0xaa36a7" : body.method === "eth_getLogs" ? [] : { number: "0x5", hash: HASH, timestamp: "0x1", gasLimit: "0x1000000", transactions: [] };
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }), { headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const result = await readHistory(r.rpc, ADDRESS, { toBlock: 5, blockHash: HASH, token: "tok/en?secret" });
    expect(result.ok).toBe(true);
    expect(r.calls()).toBe(0);
    expect(calls.length).toBeGreaterThan(0);
    expect(calls.every((call) => call.url === "https://11155111.rpc.hypersync.xyz/tok%2Fen%3Fsecret")).toBe(true);
    expect(calls.every((call) => call.init?.redirect === "error" && call.init.referrerPolicy === "no-referrer")).toBe(true);
    expect(JSON.stringify(result)).not.toContain("secret");
    if (result.ok) expect(result.value).toMatchObject({ source: "hyperrpc", fromBlock: 0, coverage: "full", deployment: null });
  });

  test("unsupported chains and missing/invalid tokens never call either provider", async () => {
    let fetches = 0;
    globalThis.fetch = (async () => { fetches++; throw new Error("Unexpected HTTP."); }) as unknown as typeof fetch;
    const supported = client(); const unsupported = client(31337);
    for (const token of ["", "secret token"]) expect((await readHistory(supported.rpc, ADDRESS, { toBlock: 5, blockHash: HASH, token })).ok).toBe(false);
    const result = await readHistory(unsupported.rpc, ADDRESS, { toBlock: 5, blockHash: HASH, token: "secret" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("unsupported");
    expect(fetches).toBe(0); expect(supported.calls()).toBe(0); expect(unsupported.calls()).toBe(0);
    expect([11155111, 84532, 10143, 43113].every(supportsHyperRpc)).toBe(true);
    expect(supportsHyperRpc(1)).toBe(false);
  });

  test("HTTP/auth/provider errors cannot expose the token or endpoint in state", async () => {
    const secret = "private-history-test-token";
    globalThis.fetch = (async () => new Response(`https://11155111.rpc.hypersync.xyz/${secret}`, { status: 403 })) as unknown as typeof fetch;
    const result = await readHistory(client().rpc, ADDRESS, { toBlock: 5, blockHash: HASH, token: secret });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(JSON.stringify(result)).not.toContain("https://");
  });
});
