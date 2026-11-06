import { expect, test } from "bun:test";
import { keccak256 } from "viem";
import type { Deployment, Hex } from "@lattice-studio/core";
import { createUpgradeRecordTracker, type UpgradeRecordIntent, type UpgradeRecordPorts } from "./upgrade-records";
import type { TransactionReview } from "./transaction";

const address = "0x0000000000000000000000000000000000000011" as const;
const from = "0x0000000000000000000000000000000000000022" as const;
const facet = "0x0000000000000000000000000000000000000033" as const;
const hash: Hex = `0x${"ab".repeat(32)}`;
const next: Hex = `0x${"cd".repeat(32)}`;
const tx: Hex = `0x${"ef".repeat(32)}`;
const snapshot = { block: 100, blockHash: hash, code: "0x6000" as const, facets: [{ facetAddress: facet, functionSelectors: ["0x12345678" as const] }], codehashes: { [facet]: hash }, ownerRouted: false, owner: null };
const origin = { chainId: 11155111, address, owner: null, block: 100, blockHash: hash, facets: snapshot.facets, codehashes: { ...snapshot.codehashes, [address]: keccak256(snapshot.code) } };
const intent: UpgradeRecordIntent = { origin, recipeHash: next, catalogHash: next, tx: { to: address, data: "0x12345678", value: 0n }, expectedFacets: snapshot.facets, expectedCodehashes: origin.codehashes };
const original: Deployment = { projectId: "original-owner", chainId: 11155111, address, path: "factory", deployer: from, salt: hash,
  status: "confirmed", tx: hash, block: 1, at: "2026-11-06T00:00:00Z", recipeHash: hash, catalogHash: hash, revision: 4, verification: "exact_match" };
const review = (): TransactionReview => ({ chainId: 11155111, tx: intent.tx, snapshot, from, contextKey: "captured-upgrade-plan", gas: 1n, simulation: { kind: "ok", block: 100, gas: 1n, method: "call" } });
function rig(record: Deployment = original) {
  let current = structuredClone(record); let serial = 0; let tail = Promise.resolve();
  const ports: UpgradeRecordPorts = { now: () => 1793923200000, reviewId: () => `review-${++serial}`, update: (_chainId, _address, update) => {
    const result = tail.then(() => { const next = update(structuredClone(current)); if (next.ok) current = structuredClone(next.value); return next; }); tail = result.then(() => undefined); return result;
  } };
  return { ports, get: () => current, tracker: createUpgradeRecordTracker(intent, record, ports) };
}

test("signing reservations keep all confirmed fields and persist exact intent with unique ownership", async () => {
  const r = rig(); const reviewed = review(); const reserved = await r.tracker.reserve(reviewed);
  expect(reserved.ok).toBe(true); expect(r.get().pendingUpgrade).toEqual(expect.objectContaining({ phase: "signing", reviewId: "review-1", from, call: { data: intent.tx.data, value: "0" } }));
  const { pendingUpgrade: _pending, ...previous } = r.get(); expect(previous).toEqual(original);
  await r.tracker.sent(reviewed, tx); expect(r.get().pendingUpgrade?.phase).toBe("pending"); expect(r.get().pendingUpgrade?.tx).toBe(tx);
  expect(r.get().recipeHash).toBe(hash); expect(r.get().revision).toBe(4);
});

test("only one concurrent reservation wins, and old cleanup never clears a newer reservation", async () => {
  const r = rig(); const first = review(), second = review();
  const results = await Promise.all([r.tracker.reserve(first), r.tracker.reserve(second)]); expect(results.filter((result) => result.ok)).toHaveLength(1);
  await r.tracker.unsent(first); expect(r.get().pendingUpgrade).toBeUndefined();
  expect((await r.tracker.reserve(second)).ok).toBe(true);
  const retained = r.get().pendingUpgrade?.reviewId;
  await r.tracker.unsent(first); expect(r.get().pendingUpgrade?.reviewId).toBe(retained); expect(retained).not.toBe("review-1");
});

test("a from-file record becomes reread only after exact fresh origin validation", async () => {
  const r = rig({ ...original, fromFile: true }); const bad = { ...review(), snapshot: { ...snapshot, code: "0x6001" as const } };
  expect((await r.tracker.reserve(bad)).ok).toBe(false); expect(r.get().fromFile).toBe(true);
  expect((await r.tracker.reserve(review())).ok).toBe(true); expect(r.get()).not.toHaveProperty("fromFile"); expect(r.get()).toEqual(expect.objectContaining({ deployer: from }));
});

test("revert/replacement removes only captured pending intent, while success needs exact post-receipt facts", async () => {
  for (const outcome of [{ kind: "receipt", hash: tx, status: "reverted", block: 101 }, { kind: "replaced", reason: "cancelled", hash: next }] as const) {
    const r = rig(); const reviewed = review(); await r.tracker.reserve(reviewed); await r.tracker.sent(reviewed, tx);
    await r.tracker.receipt(reviewed, outcome); expect(r.get()).toEqual(original);
  }
  const r = rig(); const reviewed = review(); await r.tracker.reserve(reviewed); await r.tracker.sent(reviewed, tx);
  expect(await r.tracker.receipt(reviewed, { kind: "receipt", hash: tx, status: "success", block: 101 })).toBe("verify");
  expect(r.get().pendingUpgrade?.phase).toBe("verifying"); expect(r.get().revision).toBe(4);
  const observed = { ...origin, block: 101 };
  const results = await Promise.all([r.tracker.verified(reviewed, { hash: tx, status: "success", block: 101 }, observed), r.tracker.verified(reviewed, { hash: tx, status: "success", block: 101 }, observed)]);
  expect(results.every((result) => result.ok)).toBe(true); expect(r.get().revision).toBe(5); expect(r.get().recipeHash).toBe(next); expect(r.get()).not.toHaveProperty("pendingUpgrade"); expect(r.get().projectId).toBe("original-owner");
});

test("Safe proposals are reservations without executions and cannot be erased by unsent cleanup", async () => {
  const r = rig(); const proposed = await r.tracker.propose(from, snapshot);
  expect(proposed.ok).toBe(true); expect(r.get().pendingUpgrade?.phase).toBe("proposed"); expect(r.get().revision).toBe(4); expect(r.get().tx).toBe(hash);
  await r.tracker.unsent(review()); expect(r.get().pendingUpgrade?.phase).toBe("proposed");
});
