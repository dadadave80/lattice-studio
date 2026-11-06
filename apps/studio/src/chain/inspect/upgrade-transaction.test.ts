import { expect, test } from "bun:test";
import { makeCatalog } from "@lattice-studio/core/testing";
import { ALICE, BOB, fakePort, manualClock } from "../deploy/testing";
import type { SendOutcome } from "../deploy/ports";
import { createTransactionController, type TransactionDeps, type TransactionReview } from "./transaction";

const hash = `0x${"ab".repeat(32)}` as const;
const snapshot = { block: 1, blockHash: hash, code: "0x6000" as const, facets: [{ facetAddress: BOB, functionSelectors: ["0x12345678" as const] }], codehashes: { [BOB.toLowerCase()]: hash }, ownerRouted: false, owner: null };
const intent = { chainId: 11155111, tx: { to: BOB, data: "0x12345678" as const, value: 0n }, snapshot, contextKey: "original" };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((done) => { resolve = done; }); return { promise, resolve }; }

function rig(hooks: Pick<TransactionDeps, "beforeSign" | "onUnsent" | "onSent"> = {}) {
  const port = fakePort({ catalog: () => makeCatalog() });
  let contextKey = "original";
  const controller = createTransactionController({ chains: [{ id: 11155111, testnet: true }], chain: async () => port,
    inspect: async () => ({ ok: true, value: snapshot }), context: () => ({ key: contextKey, online: true, readOnly: null }),
    subscribe: () => () => {}, clock: manualClock(), receiptTimeout: () => 1, ...hooks });
  return { controller, port, change: () => { contextKey = "changed"; } };
}

test("a definitive wallet rejection awaits cleanup of that exact reviewed reservation", async () => {
  let reserved: TransactionReview | undefined;
  const cleaned: TransactionReview[] = [];
  const r = rig({ beforeSign: async (review) => { reserved = review; return { ok: true, value: undefined }; },
    onUnsent: async (review) => { await Promise.resolve(); cleaned.push(review); } });
  r.port.sendQueue.push({ kind: "rejected" });
  await r.controller.review(intent); await r.controller.sign();
  expect(r.controller.get().phase).toBe("rejected");
  expect(cleaned).toEqual([reserved!]);
  r.controller.dispose();
});

test("context failure after reservation releases it before any wallet request", async () => {
  let clean = 0;
  const r = rig({ beforeSign: async () => { r.change(); return { ok: true, value: undefined }; }, onUnsent: async () => { clean++; } });
  await r.controller.review(intent); await r.controller.sign();
  expect(r.port.sent).toEqual([]); expect(clean).toBe(1); expect(r.controller.get().phase).toBe("failed");
  r.controller.dispose();
});

test("dispose before the wallet request still releases a completed reservation", async () => {
  const hold = deferred<void>(); const entered = deferred<void>(); let clean = 0;
  const r = rig({ beforeSign: async () => { entered.resolve(); await hold.promise; return { ok: true, value: undefined }; }, onUnsent: async () => { clean++; } });
  await r.controller.review(intent); const signing = r.controller.sign();
  await entered.promise;
  r.controller.dispose(); hold.resolve(); await signing;
  expect(r.port.sent).toEqual([]); expect(clean).toBe(1);
});

test("ambiguous wallet errors retain the reservation and a late sent hash is saved after dispose", async () => {
  let clean = 0;
  const r = rig({ onUnsent: async () => { clean++; } });
  r.port.sendQueue.push({ kind: "error", message: "Wallet response was lost." });
  await r.controller.review(intent); await r.controller.sign(); expect(clean).toBe(0); r.controller.dispose();
  const send = deferred<SendOutcome>(); const saved: string[] = [];
  const late = rig({ onUnsent: async () => { clean++; }, onSent: async (review, tx) => { saved.push(`${review.from}:${tx}`); } });
  late.port.send = () => send.promise;
  await late.controller.review(intent); const signing = late.controller.sign();
  for (let i = 0; i < 20; i++) await Promise.resolve();
  late.controller.dispose(); send.resolve({ kind: "sent", value: hash }); await signing;
  for (let i = 0; i < 20; i++) await Promise.resolve();
  expect(saved).toEqual([`${ALICE}:${hash}`]); expect(clean).toBe(0);
});
