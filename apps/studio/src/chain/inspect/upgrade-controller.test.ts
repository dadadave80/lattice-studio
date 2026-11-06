import { expect, test } from "bun:test";
import { encodeFunctionResult, keccak256, parseAbi, stringToHex } from "viem";
import { makeCatalog, makeFacet, makeInit, makeProject } from "@lattice-studio/core/testing";
import { reconstructUpgrade, type Deployment, type Hex, type Result } from "@lattice-studio/core";
import { ALICE, BOB, fakePort, flush, manualClock } from "../deploy/testing";
import { prepareUpgrade, type UpgradePreflightPorts } from "./upgrade-preflight";
import { createUpgradeTransaction, type UpgradeExecutionPorts } from "./upgrade-controller";
import type { DiamondSnapshot } from "./snapshot";

async function rig(holder = ALICE, initializerOnly = false) {
  const mechanism = makeFacet({ name: "DiamondCutFacet", family: "upgrade", selectors: ["diamondCut((address,uint8,bytes4[])[],address,bytes)"] });
  const owner = makeFacet({ name: "OwnableFacet", selectors: ["owner()"] });
  const added = makeFacet({ name: "Added", selectors: ["added()"] });
  const init = makeInit({ name: "UpgradeInit", fn: "initializeUpgrade()", params: [], initializes: [] });
  const catalog = makeCatalog({ facets: [mechanism, owner, added], inits: [init] });
  const address = "0x00000000000000000000000000000000000000AA" as const;
  const snapshot: DiamondSnapshot = { block: 100, blockHash: `0x${"ab".repeat(32)}`, code: "0x6000", facets: [mechanism, owner].map((facet) => ({ facetAddress: facet.release.address, functionSelectors: facet.selectors.map((selector) => selector.hex) })), codehashes: Object.fromEntries([mechanism, owner].map((facet) => [facet.release.address.toLowerCase(), facet.release.codehash])), ownerRouted: true, owner: holder };
  const origin = { chainId: 11155111, address, block: snapshot.block, blockHash: snapshot.blockHash, facets: snapshot.facets!, codehashes: { ...snapshot.codehashes, [address.toLowerCase()]: keccak256(snapshot.code) }, owner: holder };
  const rebuilt = reconstructUpgrade(origin, catalog); if (!rebuilt.ok) throw new Error(rebuilt.error);
  const project = makeProject({ recipe: { ...rebuilt.value, facets: initializerOnly ? rebuilt.value.facets : [...rebuilt.value.facets, added.name], ...(initializerOnly ? { init: { kind: "steps" as const, steps: [{ spec: init.name, args: {} }] } } : {}) }, upgrade: origin });
  let observed = snapshot, liveOwner = holder, key = "captured-plan", serial = 0;
  const preflight: UpgradePreflightPorts = { inspect: async () => ({ ok: true, value: observed }), catalogs: async () => ({ ok: true, value: [catalog] }), chainName: () => "Sepolia",
    call: async () => ({ ok: true, value: encodeFunctionResult({ abi: parseAbi(["function owner() view returns(address)"]), functionName: "owner", result: liveOwner }) }),
    codeAt: async (_id, address) => ({ ok: true, value: stringToHex(`test:codehash:${address.toLowerCase() === init.release!.address.toLowerCase() ? init.name : "Added"}`) }) };
  const result = await prepareUpgrade({ project, catalog, from: ALICE }, preflight); if (!result.ok) throw new Error(result.error);
  const prepared = result.value; const port = fakePort({ catalog: () => catalog }); const clock = manualClock();
  const original: Deployment = { kind: "imported", projectId: "original-record-owner", chainId: origin.chainId, address, status: "confirmed", block: 1, at: "2026-11-06T00:00:00Z", recipeHash: `0x${"01".repeat(32)}`, catalogHash: catalog.hash, revision: 2, verification: "failed" };
  let current: Deployment = structuredClone(original); let tail = Promise.resolve(); let refreshed = 0;
  const ports: UpgradeExecutionPorts = { ...preflight, chains: [{ id: origin.chainId, testnet: true }], chain: async () => port, clock, receiptTimeout: () => 1,
    context: () => ({ key, online: true, readOnly: null }), subscribe: () => () => {},
    transaction: async (_id, hash) => { const sent = port.sent.find((entry) => entry.hash.toLowerCase() === hash.toLowerCase()); return sent ? { ok: true, value: { hash, from: sent.from, ...sent.tx, nonce: 7, block: 101, blockHash: snapshot.blockHash } } : { ok: false, error: "Transaction unavailable" }; },
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

test("initializer-only live settlement refuses an unrelated newer successful hash before changing its pending intent", async () => {
  for (const patch of [{ from: BOB }, { to: BOB }, { data: "0x12345678" as Hex }, { value: 1n }, { hash: `0x${"ff".repeat(32)}` as Hex }]) {
    const r = await rig(ALICE, true);
    expect(r.prepared.plan.cuts).toEqual([]); expect(r.prepared.tx.data).not.toBe("0x");
    await r.runtime.controller.review(r.runtime.intent); await r.runtime.controller.sign(); await flush();
    const hash = r.port.sent[0]!.hash;
    const read = r.ports.transaction;
    r.ports.transaction = async (chainId, hash) => { const actual = await read(chainId, hash); return actual.ok ? { ok: true, value: { ...actual.value, ...patch } } : actual; };
    const pending = structuredClone(r.current().pendingUpgrade);
    r.mined(); r.port.mine(hash, { kind: "receipt", hash, status: "success", block: 101 }); await flush();
    expect(r.current().revision).toBe(r.original.revision); expect(r.current().recipeHash).toBe(r.original.recipeHash);
    expect(r.current().pendingUpgrade).toEqual(pending); expect(r.runtime.controller.get().verificationPending).toBe(true); r.runtime.controller.dispose();
  }
});

test("an exact newer initializer-only transaction proves execution even when final routing is unchanged", async () => {
  const r = await rig(ALICE, true); expect(r.prepared.plan.cuts).toEqual([]);
  await r.runtime.controller.review(r.runtime.intent); await r.runtime.controller.sign(); await flush();
  const hash = r.port.sent[0]!.hash; r.mined(); r.port.mine(hash, { kind: "receipt", hash, status: "success", block: 101 }); await flush();
  expect(r.current().revision).toBe(r.original.revision + 1); expect(r.current().recipeHash).toBe(r.prepared.plan.analysis.recipeHash);
  expect(r.current().pendingUpgrade).toBeUndefined(); expect(r.runtime.controller.get().verificationPending).toBe(false); r.runtime.controller.dispose();
});

test("live cancellation clears only a canonical same-sender nonce; missing or unrelated proof stays unresolved", async () => {
  const replacement = `0x${"ef".repeat(32)}` as Hex;
  for (const failure of ["none", "sender", "nonce", "receipt"] as const) {
    const r = await rig(ALICE, true); const read = r.ports.transaction;
    r.ports.transaction = async (chainId, hash) => hash === replacement ? { ok: true, value: { hash, from: failure === "sender" ? BOB : ALICE,
      to: ALICE, data: "0x", value: 0n, nonce: failure === "nonce" ? 8 : 7, block: 101, blockHash: r.prepared.snapshot.blockHash } } : read(chainId, hash);
    const receipt = r.ports.receipt;
    r.ports.receipt = async (chainId, hash) => failure === "receipt" ? { ok: false, error: "Unavailable" } : receipt(chainId, hash);
    r.port.watch = async () => ({ kind: "replaced", reason: "cancelled", hash: replacement });
    await r.runtime.controller.review(r.runtime.intent); await r.runtime.controller.sign(); await flush();
    expect(r.current().revision).toBe(r.original.revision);
    if (failure === "none") { expect(r.current()).toEqual(r.original); expect(r.runtime.controller.get().phase).toBe("cancelled"); }
    else { expect(r.current().pendingUpgrade?.tx).toBe(r.port.sent[0]!.hash); expect(r.runtime.controller.get().phase).toBe("stale"); expect(r.runtime.controller.get().error).toContain("tracking couldn't be verified"); }
    r.runtime.controller.dispose();
  }
});

test("the durable and proof baseline advances to the final pre-wallet read, blocking identical calls already mined there", async () => {
  for (const block of [101, 102]) {
    const r = await rig(ALICE, true); const inspect = r.ports.inspect; let reads = 0;
    r.ports.inspect = async (...args) => { const read = await inspect(...args); return read.ok ? { ok: true, value: { ...read.value, block: ++reads >= 5 ? (reads >= 6 ? 102 : 101) : 100 } } : read; };
    r.ports.transaction = async (_id, hash) => ({ ok: true, value: { hash, from: ALICE, ...r.prepared.tx, nonce: 7, block, blockHash: r.prepared.snapshot.blockHash } });
    r.ports.receipt = async (_id, hash) => ({ ok: true, value: { hash, status: "success", block, blockHash: r.prepared.snapshot.blockHash, logs: [] } });
    await r.runtime.controller.review(r.runtime.intent); await r.runtime.controller.sign(); await flush();
    expect(r.current().pendingUpgrade?.baseline.block).toBe(101);
    const hash = r.port.sent[0]!.hash; r.mined(); r.port.mine(hash, { kind: "receipt", hash, status: "success", block }); await flush();
    expect(r.current().revision).toBe(block === 102 ? r.original.revision + 1 : r.original.revision);
    expect(r.current().pendingUpgrade === undefined).toBe(block === 102); r.runtime.controller.dispose();
  }
});

test("an older canceled inspect cannot rebase a newer reservation during its wallet prompt", async () => {
  const r = await rig(ALICE, true); const inspect = r.ports.inspect; let reads = 0, catalogs = 0;
  let releaseCatalog!: () => void; const catalogGate = new Promise<void>((resolve) => { releaseCatalog = resolve; });
  r.ports.inspect = async (...args) => { const read = await inspect(...args); return read.ok && ++reads === 1 ? { ok: true, value: { ...read.value, block: 200 } } : read; };
  r.ports.catalogs = async () => { if (++catalogs === 1) await catalogGate; return { ok: true, value: [r.prepared.catalog] }; };
  const older = r.runtime.controller.review(r.runtime.intent); while (catalogs === 0) await flush(1);
  await r.runtime.controller.review(r.runtime.intent);
  let releaseWallet!: () => void; r.port.hold = new Promise<void>((resolve) => { releaseWallet = resolve; });
  const signing = r.runtime.controller.sign(); while (r.runtime.controller.get().phase !== "signing") await flush(1);
  expect(r.current().pendingUpgrade?.baseline.block).toBe(100);
  releaseCatalog(); await older; await flush();
  expect(r.current().pendingUpgrade?.baseline.block).toBe(100);
  releaseWallet(); await signing; await flush(); const hash = r.port.sent[0]!.hash;
  r.mined(); r.port.mine(hash, { kind: "receipt", hash, status: "success", block: 101 }); await flush();
  expect(r.current().revision).toBe(r.original.revision + 1); r.runtime.controller.dispose();
});
