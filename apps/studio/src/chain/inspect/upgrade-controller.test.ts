import { expect, test } from "bun:test";
import { encodeFunctionResult, keccak256, parseAbi, stringToHex } from "viem";
import { makeCatalog, makeFacet, makeProject } from "@lattice-studio/core/testing";
import { reconstructUpgrade, type Deployment, type Result } from "@lattice-studio/core";
import { ALICE, BOB, fakePort, flush, manualClock } from "../deploy/testing";
import { prepareUpgrade, type UpgradePreflightPorts } from "./upgrade-preflight";
import { createUpgradeTransaction, type UpgradeExecutionPorts } from "./upgrade-controller";
import type { DiamondSnapshot } from "./snapshot";

async function rig(holder = ALICE) {
  const mechanism = makeFacet({ name: "DiamondCutFacet", family: "upgrade", selectors: ["diamondCut((address,uint8,bytes4[])[],address,bytes)"] });
  const owner = makeFacet({ name: "OwnableFacet", selectors: ["owner()"] });
  const added = makeFacet({ name: "Added", selectors: ["added()"] });
  const catalog = makeCatalog({ facets: [mechanism, owner, added] });
  const address = "0x00000000000000000000000000000000000000AA" as const;
  const snapshot: DiamondSnapshot = { block: 100, blockHash: `0x${"ab".repeat(32)}`, code: "0x6000", facets: [mechanism, owner].map((facet) => ({ facetAddress: facet.release.address, functionSelectors: facet.selectors.map((selector) => selector.hex) })), codehashes: Object.fromEntries([mechanism, owner].map((facet) => [facet.release.address.toLowerCase(), facet.release.codehash])), ownerRouted: true, owner: holder };
  const origin = { chainId: 11155111, address, block: snapshot.block, blockHash: snapshot.blockHash, facets: snapshot.facets!, codehashes: { ...snapshot.codehashes, [address.toLowerCase()]: keccak256(snapshot.code) }, owner: holder };
  const rebuilt = reconstructUpgrade(origin, catalog); if (!rebuilt.ok) throw new Error(rebuilt.error);
  const project = makeProject({ recipe: { ...rebuilt.value, facets: [...rebuilt.value.facets, added.name] }, upgrade: origin });
  let observed = snapshot, liveOwner = holder, key = "captured-plan", serial = 0;
  const preflight: UpgradePreflightPorts = { inspect: async () => ({ ok: true, value: observed }), catalogs: async () => ({ ok: true, value: [catalog] }), chainName: () => "Sepolia",
    call: async () => ({ ok: true, value: encodeFunctionResult({ abi: parseAbi(["function owner() view returns(address)"]), functionName: "owner", result: liveOwner }) }),
    codeAt: async () => ({ ok: true, value: stringToHex("test:codehash:Added") }) };
  const result = await prepareUpgrade({ project, catalog, from: ALICE }, preflight); if (!result.ok) throw new Error(result.error);
  const prepared = result.value; const port = fakePort({ catalog: () => catalog }); const clock = manualClock();
  const original: Deployment = { kind: "imported", projectId: "original-record-owner", chainId: origin.chainId, address, status: "confirmed", block: 1, at: "2026-11-06T00:00:00Z", recipeHash: `0x${"01".repeat(32)}`, catalogHash: catalog.hash, revision: 2, verification: "failed" };
  let current: Deployment = structuredClone(original); let tail = Promise.resolve(); let refreshed = 0;
  const ports: UpgradeExecutionPorts = { ...preflight, chains: [{ id: origin.chainId, testnet: true }], chain: async () => port, clock, receiptTimeout: () => 1,
    context: () => ({ key, online: true, readOnly: null }), subscribe: () => () => {},
    receipt: async (_id, hash) => ({ ok: true, value: { hash, status: "success", block: 101, blockHash: snapshot.blockHash, logs: [] } }),
    records: { now: clock.now, reviewId: () => `attempt-${++serial}`, update: (_chain, _address, update) => {
      const result = tail.then(() => { const changed = update(structuredClone(current)); if (changed.ok) current = structuredClone(changed.value); return changed; }); tail = result.then(() => undefined); return result;
    } }, afterSuccess: async () => { refreshed++; } };
  const runtime = createUpgradeTransaction(prepared, original, ports);
  return { runtime, prepared, original, port, ports, current: () => current, refreshed: () => refreshed,
    switchProject: () => { key = "another-project"; }, authorityChanged: () => { liveOwner = BOB; },
    mined: () => { observed = { ...snapshot, block: 101, facets: prepared.plan.expectedFacets, codehashes: prepared.plan.expectedCodehashes }; },
    mismatch: () => { observed = { ...snapshot, block: 101 }; },
  };
}

test("review is read-only, wallet reservation preserves old revision, and a switched project cannot redirect receipt writes", async () => {
  const r = await rig(); await r.runtime.controller.review(r.runtime.intent);
  expect(r.runtime.controller.get().phase).toBe("ready"); expect(r.current()).toEqual(r.original); expect(r.port.sent).toEqual([]);
  let release!: () => void; r.port.hold = new Promise<void>((done) => { release = done; });
  const signing = r.runtime.controller.sign();
  while (r.runtime.controller.get().phase !== "signing") await flush(1);
  expect(r.current().pendingUpgrade?.phase).toBe("signing"); expect(r.current().revision).toBe(2);
  r.switchProject(); release(); await signing; await flush();
  const hash = r.port.sent[0]!.hash; expect(r.current().pendingUpgrade?.tx).toBe(hash); expect(r.current().projectId).toBe("original-record-owner");
  r.mined(); r.port.mine(hash, { kind: "receipt", hash, status: "success", block: 101 }); await flush();
  expect(r.current().revision).toBe(3); expect(r.current().recipeHash).toBe(r.prepared.plan.analysis.recipeHash); expect(r.current()).not.toHaveProperty("pendingUpgrade"); expect(r.refreshed()).toBe(1);
  r.runtime.controller.dispose();
});

test("changed role/owner policy or new runtime code prevents sending", async () => {
  for (const change of [(r: Awaited<ReturnType<typeof rig>>) => r.authorityChanged(), (r: Awaited<ReturnType<typeof rig>>) => { r.ports.codeAt = async () => ({ ok: true, value: "0x" }); }]) {
    const r = await rig(); await r.runtime.controller.review(r.runtime.intent); change(r); await r.runtime.controller.sign();
    expect(r.port.sent).toEqual([]); expect(r.current()).toEqual(r.original); r.runtime.controller.dispose();
  }
});

test("a rejected wallet clears its reservation while an ambiguous error leaves an unresolved signing intent", async () => {
  for (const outcome of [{ kind: "rejected" }, { kind: "error", message: "Response lost." }] as const) {
    const r = await rig(); r.port.sendQueue.push(outcome); await r.runtime.controller.review(r.runtime.intent); await r.runtime.controller.sign();
    expect(r.current().pendingUpgrade?.phase).toBe(outcome.kind === "rejected" ? undefined : "signing"); expect(r.current().revision).toBe(2); r.runtime.controller.dispose();
  }
});

test("a successful receipt with the wrong loupe never advances the revision", async () => {
  const r = await rig(); await r.runtime.controller.review(r.runtime.intent); await r.runtime.controller.sign(); await flush();
  const hash = r.port.sent[0]!.hash; r.mismatch(); r.port.mine(hash, { kind: "receipt", hash, status: "success", block: 101 }); await flush();
  expect(r.current().revision).toBe(2); expect(r.current().pendingUpgrade?.phase).toBe("verifying"); expect(r.runtime.controller.get().verificationPending).toBe(true);
  r.runtime.controller.dispose();
});

test("unrelated Safe exports fail before preparing any proposal", async () => {
  const r = await rig(); const checked: Result<void, string> = await r.runtime.beforeSafeExport(BOB);
  expect(checked.ok).toBe(false); expect(r.current()).toEqual(r.original); expect(r.port.sent).toEqual([]); r.runtime.controller.dispose();
});

test("an authenticated owner Safe reserves an exact Call proposal without executing or changing confirmed facts", async () => {
  const r = await rig(BOB);
  const abi = parseAbi(["function owner() view returns(address)", "function getThreshold() view returns(uint256)", "function getOwners() view returns(address[])"]);
  r.ports.call = async (target, data) => ({ ok: true, value: target.address.toLowerCase() === BOB.toLowerCase()
    ? data.startsWith("0xe75235b8") ? encodeFunctionResult({ abi, functionName: "getThreshold", result: 1n }) : encodeFunctionResult({ abi, functionName: "getOwners", result: [ALICE] })
    : encodeFunctionResult({ abi, functionName: "owner", result: BOB }) });
  const proposal = await r.runtime.beforeSafeExport(BOB); expect(proposal.ok).toBe(true);
  expect(r.current().pendingUpgrade).toEqual(expect.objectContaining({ phase: "proposed", from: BOB, call: { data: r.prepared.tx.data, value: "0" } }));
  const { pendingUpgrade: _pending, ...confirmed } = r.current(); expect(confirmed).toEqual(r.original);
  expect(r.port.sent).toEqual([]); expect((await r.runtime.onSafeExport()).ok).toBe(true); expect(r.current().revision).toBe(r.original.revision);
  r.runtime.controller.dispose();
});

test("a receipt reorg during fresh verification retains the old revision and saved hash", async () => {
  const r = await rig(); let receiptReads = 0;
  r.ports.receipt = async (_id, hash) => ({ ok: true, value: { hash, status: "success", block: 101, blockHash: `0x${(++receiptReads === 1 ? "ab" : "cd").repeat(32)}`, logs: [] } });
  await r.runtime.controller.review(r.runtime.intent); await r.runtime.controller.sign(); await flush();
  const hash = r.port.sent[0]!.hash; r.mined(); r.port.mine(hash, { kind: "receipt", hash, status: "success", block: 101 }); await flush();
  expect(r.current().revision).toBe(r.original.revision); expect(r.current().pendingUpgrade?.phase).toBe("verifying");
  expect(r.runtime.controller.get().verificationPending).toBe(true); expect(r.runtime.controller.get().error).toContain("couldn't be verified or saved"); r.runtime.controller.dispose();
});

test("historical and same-baseline receipts cannot clear or verify a newly sent attempt", async () => {
  for (const block of [50, 100]) {
    const r = await rig();
    r.ports.receipt = async (_id, hash) => ({ ok: true, value: { hash, status: "success", block, blockHash: r.prepared.snapshot.blockHash, logs: [] } });
    await r.runtime.controller.review(r.runtime.intent); await r.runtime.controller.sign(); await flush();
    const hash = r.port.sent[0]!.hash; r.mined(); r.port.mine(hash, { kind: "receipt", hash, status: "success", block }); await flush();
    expect(r.current().revision).toBe(r.original.revision); expect(r.current().pendingUpgrade?.phase).toBe("pending");
    expect(r.current().pendingUpgrade?.tx).toBe(hash); expect(r.runtime.controller.get().verificationPending).toBe(true); r.runtime.controller.dispose();
  }
});
