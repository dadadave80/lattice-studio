import { describe, expect, test } from "bun:test";
import type { Hex, Result } from "@lattice-studio/core";
import { makeCatalog } from "@lattice-studio/core/testing";
import { ALICE, BOB, fakePort, manualClock } from "../deploy/testing";
import type { ReceiptOutcome, SimulationOutcome, TxStatus } from "../deploy/ports";
import type { DiamondSnapshot } from "./snapshot";
import { createTransactionController, type TransactionDeps, type TransactionIntent } from "./transaction";

const TARGET = "0x00000000000000000000000000000000000000AA";
const HASH: Hex = `0x${"ab".repeat(32)}`;
const snapshot = (): DiamondSnapshot => ({ block: 1, blockHash: HASH, code: "0x6000", facets: [{ facetAddress: BOB, functionSelectors: ["0x12345678"] }], codehashes: { [BOB.toLowerCase()]: HASH }, ownerRouted: true, owner: BOB });
const intent = (): TransactionIntent => ({ chainId: 11155111, tx: { to: TARGET, data: "0x12345678", value: 12n }, snapshot: snapshot(), contextKey: "captured-project" });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }
async function settle() { for (let i = 0; i < 20; i++) await Promise.resolve(); }

function rig(overrides: Partial<TransactionDeps> = {}) {
  const port = fakePort({ catalog: () => makeCatalog() });
  const clock = manualClock();
  let observed = snapshot();
  let key = "captured-project";
  const listeners = new Set<() => void>();
  const sent: string[] = [];
  const receipts: ReceiptOutcome[] = [];
  let refreshed = 0;
  const controller = createTransactionController({
    chains: [{ id: 11155111, testnet: true }],
    chain: async () => port, inspect: async () => ({ ok: true, value: observed }),
    context: () => ({ key, online: true, readOnly: null }), subscribe: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    clock, receiptTimeout: () => 1,
    onSent: async (review, hash) => { sent.push(`${review.contextKey}:${hash}`); },
    onReceipt: async (_review, receipt) => { receipts.push(receipt); },
    onSuccess: async () => { refreshed++; },
    ...overrides,
  });
  return { port, clock, controller, sent, receipts, refreshed: () => refreshed, observe: (next: DiamondSnapshot) => { observed = next; }, change: (next: string) => { key = next; for (const listener of listeners) listener(); } };
}

describe("generic transaction review", () => {
  test("copies the intended request before an asynchronous chain load", async () => {
    const held = deferred<void>();
    const r = rig();
    const input = intent();
    const original = r.controller;
    const next = rig({ chain: async () => { await held.promise; return r.port; } });
    const reviewing = next.controller.review(input);
    input.tx.data = "0xdeadbeef";
    held.resolve();
    await reviewing;
    expect(next.controller.get().review?.tx.data).toBe("0x12345678");
    original.dispose(); next.controller.dispose();
  });
  test("review never sends, captures exact inputs, and allows a simulated non-owner write", async () => {
    const r = rig();
    const input = intent();
    await r.controller.review(input);
    expect(r.controller.get().phase).toBe("ready");
    expect(r.controller.get().review?.from).toBe(ALICE);
    expect(r.port.sent).toEqual([]);
    input.tx.data = "0xdeadbeef";
    input.snapshot.code = "0x6001";
    await r.controller.sign();
    expect(r.port.sent).toHaveLength(1);
    expect(r.port.sent[0]?.tx).toEqual({ to: TARGET, data: "0x12345678", value: 12n });
    expect(r.port.sent[0]?.gas).toBe(3_000_000n);
    expect(r.port.calls.filter((call) => call.method === "simulate")).toHaveLength(2);
    r.controller.dispose();
  });

  test("wrong wallet chain, account changes, context changes and code/routing changes prevent signing", async () => {
    for (const change of [
      (r: ReturnType<typeof rig>) => { r.port.setAccount({ address: BOB, chainId: 11155111 }); },
      (r: ReturnType<typeof rig>) => { r.port.setAccount({ address: ALICE, chainId: 84532 }); },
      (r: ReturnType<typeof rig>) => { r.change("another-project"); },
      (r: ReturnType<typeof rig>) => { r.observe({ ...snapshot(), code: "0x6001" }); },
      (r: ReturnType<typeof rig>) => { r.observe({ ...snapshot(), facets: [{ facetAddress: BOB, functionSelectors: ["0xdeadbeef"] }] }); },
    ]) {
      const r = rig();
      await r.controller.review(intent());
      change(r);
      await r.controller.sign();
      expect(r.port.sent).toHaveLength(0);
      expect(r.controller.get().phase).toBe("failed");
      r.controller.dispose();
    }
  });

  test("mere block advance is allowed, but a fresh gas cap and successful estimated simulation are required", async () => {
    const r = rig();
    await r.controller.review(intent());
    r.observe({ ...snapshot(), block: 2, blockHash: `0x${"cd".repeat(32)}` });
    r.port.patch(11155111, { gasCap: "2999999" });
    await r.controller.sign();
    expect(r.port.sent).toHaveLength(0);
    expect(r.controller.get().error).toContain("gas cap");
    r.port.patch(11155111, { gasCap: "16777216" });
    await r.controller.review(intent());
    r.port.simulation = { kind: "reverted", block: 2, data: "0x1234", method: "call" };
    await r.controller.sign();
    expect(r.controller.get().revertData).toBe("0x1234");
    expect(r.port.sent).toHaveLength(0);
    r.controller.dispose();
  });

  test("an obsolete simulation cannot overwrite a later review", async () => {
    const r = rig();
    const held = deferred<SimulationOutcome>();
    const original = r.port.simulate;
    let count = 0;
    r.port.simulate = (...args) => ++count === 1 ? held.promise : original(...args);
    const first = r.controller.review(intent());
    await settle();
    const next = intent(); next.tx.data = "0xabcdef01";
    await r.controller.review(next);
    held.resolve({ kind: "reverted", block: 1, data: "0x1234", method: "call" });
    await first;
    expect(r.controller.get().phase).toBe("ready");
    expect(r.controller.get().review?.tx.data).toBe("0xabcdef01");
    r.controller.dispose();
  });

  test("rejection can be explicitly retried; pending is never resent and late success refreshes facts", async () => {
    const r = rig();
    r.port.sendQueue.push({ kind: "rejected" });
    await r.controller.review(intent());
    await r.controller.sign();
    expect(r.controller.get().phase).toBe("rejected");
    await r.controller.sign();
    const hash = r.controller.get().hash!;
    expect(r.controller.get().phase).toBe("pending");
    await r.controller.sign();
    expect(r.port.sent).toHaveLength(1);
    r.clock.advance(1001);
    expect(r.controller.get().phase).toBe("stale");
    r.controller.keepWaiting();
    expect(r.controller.get().phase).toBe("pending");
    r.change("different-project-after-send");
    const repriced = `0x${"ef".repeat(32)}` as Hex;
    r.port.reprice(hash, repriced);
    await settle();
    expect(r.controller.get().hash).toBe(repriced);
    r.port.mine(repriced, { kind: "receipt", status: "success", hash: repriced, block: 2 });
    await settle();
    expect(r.controller.get().phase).toBe("confirmed");
    expect(r.sent.every((row) => row.startsWith("captured-project:"))).toBe(true);
    expect(r.refreshed()).toBe(1);
    r.controller.dispose();
  });

  test("a reverted receipt retains transaction/revert bytes and replacement is cancellation, not success", async () => {
    const r = rig();
    await r.controller.review(intent()); await r.controller.sign();
    const hash = r.controller.get().hash!;
    r.port.replayData = "0xdeadbeef";
    r.port.mine(hash, { kind: "receipt", hash, status: "reverted", block: 2 });
    await settle();
    expect(r.controller.get()).toMatchObject({ phase: "failed", hash, revertData: "0xdeadbeef" });
    expect(r.refreshed()).toBe(0);
    await r.controller.review(intent()); await r.controller.sign();
    const next = r.controller.get().hash!;
    r.port.mine(next, { kind: "replaced", hash: HASH, reason: "cancelled" });
    await settle();
    expect(r.controller.get().phase).toBe("cancelled");
    expect(r.refreshed()).toBe(0);
    r.controller.dispose();
  });

  test("tracking/refresh failures retain the sent hash and known receipt truth without enabling resend", async () => {
    const r = rig({ onSent: async () => { throw new Error("quota"); }, onSuccess: async () => { throw new Error("offline"); } });
    await r.controller.review(intent()); await r.controller.sign();
    const hash = r.controller.get().hash!;
    expect(r.controller.get().phase).toBe("pending");
    expect(r.port.watching()).toEqual([hash]);
    await r.controller.sign();
    expect(r.port.sent).toHaveLength(1);
    r.port.mine(hash, { kind: "receipt", hash, status: "success", block: 2 });
    await settle();
    expect(r.controller.get()).toMatchObject({ phase: "confirmed", hash, verificationPending: true });
    expect(r.controller.get().error).toContain("succeeded");
    r.controller.dispose();
  });

  test("a project switch while the wallet prompt is open preserves captured sent/receipt identities", async () => {
    const captured: string[] = [];
    const r = rig({ onReceipt: async (review) => { captured.push(review.contextKey); } });
    const held = deferred<void>();
    r.port.hold = held.promise;
    await r.controller.review(intent());
    const sending = r.controller.sign();
    await settle();
    expect(r.controller.get().phase).toBe("signing");
    r.change("different-project-before-wallet-return");
    held.resolve();
    await sending;
    const hash = r.controller.get().hash!;
    expect(r.controller.get().phase).toBe("pending");
    expect(r.sent).toEqual([`captured-project:${hash}`]);
    r.port.mine(hash, { kind: "receipt", hash, status: "success", block: 2 });
    await settle();
    expect(captured).toEqual(["captured-project"]);
    expect(r.controller.get().phase).toBe("confirmed");
    r.controller.dispose();
  });

  test("two explicit sign clicks during preflight still send only once", async () => {
    const r = rig();
    await r.controller.review(intent());
    const held = deferred<SimulationOutcome>();
    r.port.simulate = () => held.promise;
    const first = r.controller.sign();
    await settle();
    await r.controller.sign();
    held.resolve({ kind: "ok", block: 2, gas: 30_000n, method: "call" });
    await first;
    expect(r.port.sent).toHaveLength(1);
    r.controller.dispose();
  });

  test("a broken receipt watch can restart observation without resending", async () => {
    const r = rig();
    const original = r.port.watch;
    let failed = false;
    r.port.watch = (...args) => {
      if (!failed) { failed = true; return Promise.reject(new Error("https://private.example/secret-token")); }
      return original(...args);
    };
    await r.controller.review(intent()); await r.controller.sign();
    await settle();
    expect(r.controller.get().phase).toBe("stale");
    expect(r.controller.get().error).not.toContain("secret-token");
    r.controller.keepWaiting();
    const hash = r.controller.get().hash!;
    expect(r.port.watching()).toEqual([hash]);
    r.port.mine(hash, { kind: "receipt", hash, status: "success", block: 2 });
    await settle();
    expect(r.controller.get().phase).toBe("confirmed");
    expect(r.port.sent).toHaveLength(1);
    r.controller.dispose();
  });

  test("an old hash's wallet-status result cannot overwrite a repriced transaction", async () => {
    const r = rig();
    await r.controller.review(intent()); await r.controller.sign();
    const status = deferred<Result<TxStatus, string>>();
    r.port.transactionStatus = () => status.promise;
    const checking = r.controller.checkWallet();
    const old = r.controller.get().hash!;
    r.port.reprice(old, HASH);
    status.resolve({ ok: true, value: "unknown" });
    await checking;
    expect(r.controller.get().hash).toBe(HASH);
    expect(r.controller.get().error).toBeUndefined();
    r.controller.dispose();
  });

  test.each(["onSent", "onReceipt", "onSuccess"] as const)("%s failure retains successful receipt with verification pending", async (hook) => {
    const r = rig({ [hook]: async () => { throw new Error("quota or RPC failure"); } });
    await r.controller.review(intent()); await r.controller.sign();
    const hash = r.controller.get().hash!;
    r.port.mine(hash, { kind: "receipt", hash, status: "success", block: 2 });
    await settle();
    expect(r.controller.get()).toMatchObject({ phase: "confirmed", hash, verificationPending: true });
    expect(r.controller.get().error).toContain(hook === "onSuccess" ? "succeeded" : "success receipt was observed");
    r.controller.dispose();
  });

  test("context or code changes while beforeSign is saving cannot reach the wallet", async () => {
    const ready = deferred<Result<void, string>>();
    const r = rig({ beforeSign: () => ready.promise });
    await r.controller.review(intent());
    const signing = r.controller.sign();
    await settle();
    r.observe({ ...snapshot(), code: "0x6001" });
    ready.resolve({ ok: true, value: undefined });
    await signing;
    expect(r.controller.get().phase).toBe("failed");
    expect(r.port.sent).toHaveLength(0);
    r.controller.dispose();
  });

  test.each([
    { ...intent(), chainId: 1 },
    { ...intent(), tx: { ...intent().tx, value: -1n } },
    { ...intent(), tx: { ...intent().tx, data: "0x123" as Hex } },
    { ...intent(), tx: { ...intent().tx, value: 1n << 256n } },
    { ...intent(), tx: { ...intent().tx, to: "0x0000000000000000000000000000000000000000" as const } },
    { ...intent(), snapshot: { ...snapshot(), code: "0x" as Hex } },
  ])("invalid request never simulates or sends", async (input) => {
    const r = rig();
    await r.controller.review(input);
    expect(r.controller.get().phase).toBe("failed");
    expect(r.port.calls).toEqual([]);
    r.controller.dispose();
  });

  test.each([
    { kind: "unavailable", message: "Simulation is unavailable." },
    { kind: "ok", block: 1, gas: 0n, method: "call" },
  ] satisfies SimulationOutcome[])("a missing successful simulation/estimate never enables send", async (simulation) => {
    const r = rig();
    r.port.simulation = simulation;
    await r.controller.review(intent());
    expect(r.controller.get().phase).toBe("failed");
    await r.controller.sign();
    expect(r.port.sent).toHaveLength(0);
    r.controller.dispose();
  });
});
