import { expect, test } from "bun:test";
import { encodeFunctionData, keccak256 } from "viem";
import { UPGRADE_ABI } from "./upgrade-preflight";
import type { Deployment, Hex, Result } from "@lattice-studio/core";
import type { ReceiptOutcome, WatchOptions } from "../deploy/ports";
import { makeCatalog } from "@lattice-studio/core/testing";
import { fakePort } from "../deploy/testing";
import { createUpgradeObserver, type UpgradeTrackingPorts } from "./upgrade-tracking";
import type { UpgradeObservedTransaction } from "./upgrade-evidence";

const address = "0x0000000000000000000000000000000000000011" as const;
const from = "0x0000000000000000000000000000000000000022" as const;
const facet = "0x0000000000000000000000000000000000000033" as const;
const hash: Hex = `0x${"ab".repeat(32)}`, next: Hex = `0x${"cd".repeat(32)}`, txHash: Hex = `0x${"ef".repeat(32)}`;
const target = { chainId: 11155111, address };
const snapshot = { block: 101, blockHash: hash, code: "0x6000" as const, facets: [{ facetAddress: facet, functionSelectors: ["0x12345678" as const] }], codehashes: { [facet]: hash }, ownerRouted: false, owner: null };
const baseline = { block: 100, blockHash: hash, facets: snapshot.facets, codehashes: { ...snapshot.codehashes, [address]: keccak256(snapshot.code) } };
const original: Deployment = { projectId: "original-owner", chainId: target.chainId, address, path: "factory", deployer: from, salt: hash,
  status: "confirmed", tx: hash, block: 1, at: "2026-11-06T00:00:00Z", recipeHash: hash, catalogHash: hash, revision: 4, verification: "exact_match" };
const saved: Deployment = { ...original, pendingUpgrade: { phase: "signing", reviewId: "review-1", from, since: original.at,
  desiredRecipeHash: next, catalogHash: next, baseline, expectedFacets: snapshot.facets, expectedCodehashes: baseline.codehashes, call: { data: "0x12345678", value: "0" } } };
const transaction: UpgradeObservedTransaction = { hash: txHash, from, to: address, data: "0x12345678", value: 0n };
function rig(initial = saved) {
  let current = structuredClone(initial), reads = snapshot, tx = transaction, watched = 0, options: WatchOptions | null = null;
  let settle: (value: ReceiptOutcome) => void = () => {};
  const result = new Promise<ReceiptOutcome>((resolve) => { settle = resolve; });
  let tail = Promise.resolve();
  const ports: UpgradeTrackingPorts = {
    get: async () => structuredClone(current), update: (_chainId, _address, update) => {
      const result = tail.then(() => { const next = update(structuredClone(current)); if (next.ok) current = structuredClone(next.value); return next; }); tail = result.then(() => undefined); return result;
    },
    inspect: async () => ({ ok: true, value: reads }), catalogs: async () => ({ ok: true, value: [] }),
    call: async () => ({ ok: false, error: { reason: "Unused", data: null } }), codeAt: async () => ({ ok: false, error: "Unused" }), chainName: () => "Sepolia",
    transaction: async () => ({ ok: true, value: tx }), receipt: async () => ({ ok: true, value: { hash: tx.hash, status: "success", block: 101, blockHash: hash, logs: [] } }),
    chain: async () => ({ ...fakePort({ catalog: () => makeCatalog() }), watch: async (_chainId: number, _hash: Hex, next: WatchOptions) => { watched++; options = next; return result; }, send: async () => { throw new Error("Observation must never send."); } }),
  };
  const observer = createUpgradeObserver(ports);
  return { ports, observer, get: () => current, watched: () => watched, options: () => options, set: (record: Deployment) => { current = record; },
    tx: (next: UpgradeObservedTransaction) => { tx = next; }, snapshot: (next: typeof reads) => { reads = next; }, settle,
  };
}
async function finished(r: ReturnType<typeof rig>) {
  for (let i = 0; i < 100 && r.observer.get(target).status === "watching"; i++) await Bun.sleep(1);
  expect(r.observer.get(target).status).not.toBe("watching");
}

test("unknown wallet outcomes remain saved, and exact manual recovery observes then settles once", async () => {
  const r = rig(); expect((await r.observer.resume(target)).ok).toBe(false); expect(r.get()).toEqual(saved); expect(r.watched()).toBe(0);
  const results = await Promise.all([r.observer.resume(target, { txHash }), r.observer.resume(target, { txHash })]);
  expect(results.every((value) => value.ok)).toBe(true); expect(r.watched()).toBe(1); expect(r.get().pendingUpgrade?.tx).toBe(txHash);
  expect(r.get().revision).toBe(4); r.settle({ kind: "receipt", hash: txHash, status: "success", block: 101 }); await finished(r);
  expect(r.observer.get(target).status).toBe("verified"); expect(r.get()).toEqual({ ...original, recipeHash: next, catalogHash: next, revision: 5 });
  expect((await r.observer.resume(target)).ok).toBe(false); expect(r.get().revision).toBe(5); r.observer.dispose();
});

test("legacy, unrelated and provider-mismatched manual hashes never attach", async () => {
  const { call: _call, ...legacy } = saved.pendingUpgrade!;
  for (const initial of [{ ...saved, pendingUpgrade: legacy }, saved]) {
    const r = rig(initial); r.tx({ ...transaction, to: from });
    expect((await r.observer.resume(target, { txHash })).ok).toBe(false); expect(r.get()).toEqual(initial); expect(r.watched()).toBe(0); r.observer.dispose();
  }
  const r = rig(); r.tx({ ...transaction, hash: next }); expect((await r.observer.resume(target, { txHash })).ok).toBe(false); expect(r.get()).toEqual(saved); r.observer.dispose();
});

test("a successful receipt with different routing leaves the confirmed facts and verifying reservation intact", async () => {
  const r = rig(); r.snapshot({ ...snapshot, facets: [] }); await r.observer.resume(target, { txHash });
  r.settle({ kind: "receipt", hash: txHash, status: "success", block: 101 }); await finished(r);
  expect(r.get().revision).toBe(4); expect(r.get().recipeHash).toBe(hash); expect(r.get().pendingUpgrade?.phase).toBe("verifying"); expect(r.observer.get(target).reason).toContain("routing"); r.observer.dispose();
});

test("a newer reservation cannot be overwritten by an old receipt callback", async () => {
  const r = rig(); await r.observer.resume(target, { txHash });
  const newer = { ...r.get(), pendingUpgrade: { ...r.get().pendingUpgrade!, reviewId: "new-review", desiredRecipeHash: hash } }; r.set(newer);
  r.settle({ kind: "receipt", hash: txHash, status: "success", block: 101 }); await finished(r); expect(r.get()).toEqual(newer); expect(r.observer.get(target).status).toBe("error"); r.observer.dispose();
});

test("stop aborts observation without discarding an unknown wallet outcome; only unsent proposals are discardable", async () => {
  const r = rig(); await r.observer.resume(target, { txHash }); r.observer.stop(target);
  expect(r.options()?.signal.aborted).toBe(true); expect(r.get().pendingUpgrade?.tx).toBe(txHash); expect((await r.observer.discardProposal(target)).ok).toBe(false);
  r.settle({ kind: "aborted" }); r.observer.dispose();
  const proposed = rig({ ...saved, pendingUpgrade: { ...saved.pendingUpgrade!, phase: "proposed" } });
  expect((await proposed.observer.discardProposal(target)).ok).toBe(true); expect(proposed.get()).toEqual(original); proposed.observer.dispose();
});

test("cancel/replacement clears only the unresolved attempt while preserving creation and confirmed facts", async () => {
  const r = rig(); await r.observer.resume(target, { txHash }); r.settle({ kind: "replaced", reason: "cancelled", hash: next }); await finished(r);
  expect(r.get()).toEqual(original); expect(r.observer.get(target).reason).toContain("replaced"); r.observer.dispose();
});

test("storage rejection cannot start an unrecorded watcher", async () => {
  const r = rig(); r.ports.update = async (): Promise<Result<Deployment, string>> => ({ ok: false, error: "Storage refused the intent." });
  expect((await r.observer.resume(target, { txHash })).ok).toBe(false); expect(r.watched()).toBe(0); expect(r.get()).toEqual(saved); r.observer.dispose();
});

test("a concurrent completion is independently re-proved and never increments twice", async () => {
  for (const matches of [true, false]) {
    const r = rig(); await r.observer.resume(target, { txHash });
    const completed = { ...original, recipeHash: next, catalogHash: next, revision: 5 }; r.set(completed);
    if (!matches) r.snapshot({ ...snapshot, facets: [] });
    r.settle({ kind: "receipt", hash: txHash, status: "success", block: 101 }); await finished(r);
    expect(r.observer.get(target).status).toBe(matches ? "verified" : "error"); expect(r.get()).toEqual(completed); r.observer.dispose();
  }
});

test("a canonical receipt changing during reread never advances the saved revision", async () => {
  const r = rig(); let count = 0;
  r.ports.receipt = async () => ({ ok: true, value: { hash: txHash, status: "success", block: 101, blockHash: ++count <= 2 ? hash : next, logs: [] } });
  await r.observer.resume(target, { txHash }); r.settle({ kind: "receipt", hash: txHash, status: "success", block: 101 }); await finished(r);
  expect(r.get().revision).toBe(4); expect(r.get().pendingUpgrade?.phase).toBe("verifying"); expect(r.observer.get(target).reason).toContain("receipt changed"); r.observer.dispose();
});

test("provider exceptions never reveal credential URLs in recovery status", async () => {
  const r = rig(); const chain = await r.ports.chain();
  r.ports.chain = async () => ({ ...chain, watch: async () => { throw new Error("https://private.example/rpc?key=secret-token"); } });
  await r.observer.resume(target, { txHash }); await finished(r);
  expect(r.observer.get(target).status).toBe("error"); expect(JSON.stringify(r.observer.get(target))).not.toContain("secret-token"); expect(r.get().pendingUpgrade?.tx).toBe(txHash); r.observer.dispose();
});

test("a historical initializer-only recovery hash is refused before saving or watching it", async () => {
  const data = encodeFunctionData({ abi: UPGRADE_ABI, functionName: "diamondCut", args: [[], from, "0x1234"] });
  const initial = { ...saved, pendingUpgrade: { ...saved.pendingUpgrade!, call: { data, value: "0" } } };
  const r = rig(initial); r.tx({ ...transaction, data });
  r.ports.receipt = async () => ({ ok: true, value: { hash: txHash, status: "success", block: 50, blockHash: hash, logs: [] } });
  expect((await r.observer.resume(target, { txHash })).ok).toBe(false);
  expect(r.get()).toEqual(initial); expect(r.watched()).toBe(0); expect(r.observer.get(target).reason).toContain("fresh baseline"); r.observer.dispose();
});
