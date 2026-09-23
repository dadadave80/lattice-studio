import { describe, expect, test } from "bun:test";
import type { Hex } from "@lattice-studio/core";
import { providerWallet, type Eip1193 } from "./app-port";

const FROM = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as const;
const TX = { to: "0x4e59b44847b379578588920cA78FbF26c0B4956C" as const, data: "0x1234" as Hex, value: 0n };

function wallet(answer: (method: string, params: unknown) => unknown): { provider: Eip1193; calls: { method: string; params: unknown }[] } {
  const calls: { method: string; params: unknown }[] = [];
  return {
    calls,
    provider: {
      async request({ method, params }) {
        calls.push({ method, params });
        return answer(method, params);
      },
    },
  };
}

describe("the wallet over the connected EIP-1193 provider", () => {
  test("sends with eth_sendTransaction, hex value and the batch's own gas", async () => {
    const w = wallet(() => `0x${"AB".repeat(32)}`);
    const out = await providerWallet(async () => w.provider).send(11155111, { from: FROM, tx: TX, gas: 21_000n });
    expect(out).toEqual({ kind: "sent", value: `0x${"ab".repeat(32)}` });
    expect(w.calls[0]).toEqual({ method: "eth_sendTransaction", params: [{ from: FROM, to: TX.to, data: "0x1234", value: "0x0", gas: "0x5208" }] });
  });

  test("a 4001 is a rejection; anything else is its message; no wallet says to connect one", async () => {
    const rejecting = wallet(() => Promise.reject({ code: 4001, message: "User rejected the request." }));
    expect(await providerWallet(async () => rejecting.provider).send(1, { from: FROM, tx: TX })).toEqual({ kind: "rejected" });
    const failing = wallet(() => Promise.reject(new Error("insufficient funds for gas")));
    expect(await providerWallet(async () => failing.provider).send(1, { from: FROM, tx: TX })).toEqual({ kind: "error", message: "insufficient funds for gas." });
    expect(await providerWallet(async () => null).send(1, { from: FROM, tx: TX })).toEqual({ kind: "error", message: "Connect a wallet first." });
  });

  test("atomic support is EIP-5792's `atomic: supported` for the chain", async () => {
    const supported = wallet(() => ({ "0xaa36a7": { atomic: { status: "supported" } } }));
    expect(await providerWallet(async () => supported.provider).atomicBatch(11155111, FROM)).toBe(true);
    expect(supported.calls[0]).toEqual({ method: "wallet_getCapabilities", params: [FROM, ["0xaa36a7"]] });
    const ready = wallet(() => ({ "0xaa36a7": { atomic: { status: "ready" } } }));
    expect(await providerWallet(async () => ready.provider).atomicBatch(11155111, FROM)).toBe(false);
    const unsupported = wallet(() => Promise.reject({ code: -32601 }));
    expect(await providerWallet(async () => unsupported.provider).atomicBatch(11155111, FROM)).toBe(false);
  });

  test("wallet_sendCalls asks for an atomic batch, then its status is polled until final", async () => {
    let polls = 0;
    const w = wallet((method) => {
      if (method === "wallet_sendCalls") return { id: "calls-1" };
      polls += 1;
      return polls < 2 ? { status: 100 } : { status: 200, receipts: [{ transactionHash: `0x${"cd".repeat(32)}`, status: "0x1", blockNumber: "0x10" }] };
    });
    const port = providerWallet(async () => w.provider);
    expect(await port.sendCalls(11155111, { from: FROM, calls: [TX, TX] })).toEqual({ kind: "sent", value: "calls-1" });
    expect(w.calls[0]?.params).toEqual([{ version: "2.0.0", chainId: "0xaa36a7", from: FROM, atomicRequired: true, calls: [
      { to: TX.to, data: "0x1234", value: "0x0" }, { to: TX.to, data: "0x1234", value: "0x0" },
    ] }]);
    const done = await port.waitCalls(11155111, "calls-1", new AbortController().signal);
    expect(done).toEqual({ kind: "done", status: "success", receipts: [{ hash: `0x${"cd".repeat(32)}`, status: "success", block: 16 }] });
  });
});
