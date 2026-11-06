import { expect, test } from "bun:test";
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, parseAbi, parseAbiParameters } from "viem";
import type { Deployment, Hex, PendingUpgrade } from "@lattice-studio/core";
import { DIAMOND_CUT_EVENT } from "./history-codec";
import { UPGRADE_ABI } from "./upgrade-preflight";
import { SAFE_EXEC_ABI, verifyUpgradeEvidence, verifyUpgradeTransaction, type UpgradeObservedReceipt, type UpgradeObservedTransaction } from "./upgrade-evidence";

const diamond = "0x0000000000000000000000000000000000000011" as const;
const safe = "0x0000000000000000000000000000000000000022" as const;
const alice = "0x0000000000000000000000000000000000000033" as const;
const hash: Hex = `0x${"ab".repeat(32)}`;
const cuts = [{ facetAddress: alice, action: 0, functionSelectors: ["0x12345678"] }] as const;
const data = encodeFunctionData({ abi: UPGRADE_ABI, functionName: "diamondCut", args: [cuts, diamond, "0x1234"] });
const pending: PendingUpgrade = { phase: "proposed", reviewId: "review-1", from: safe, since: "2026-11-06T00:00:00Z", desiredRecipeHash: hash, catalogHash: hash,
  baseline: { block: 1, blockHash: hash, facets: [], codehashes: { [diamond]: hash } }, expectedFacets: [], expectedCodehashes: { [diamond]: hash }, call: { data, value: "0" } };
const record: Deployment = { kind: "imported", projectId: "owner", chainId: 11155111, address: diamond, status: "confirmed", recipeHash: hash, catalogHash: hash, at: pending.since, revision: 1, verification: "failed", pendingUpgrade: pending };
const receipt: UpgradeObservedReceipt = { hash, status: "success", block: 2, blockHash: hash, logs: [] };
const direct: UpgradeObservedTransaction = { hash, from: safe, to: diamond, data, value: 0n };
const safeTx: UpgradeObservedTransaction = { hash, from: alice, to: safe, value: 0n, data: encodeFunctionData({ abi: SAFE_EXEC_ABI, functionName: "execTransaction", args: [diamond, 0n, data, 0, 0n, 0n, 0n, diamond, diamond, "0x"] }) };
const cutLog = { address: diamond, topics: encodeEventTopics({ abi: [DIAMOND_CUT_EVENT], eventName: "DiamondCut" }) as Hex[], data: encodeAbiParameters(parseAbiParameters("(address,uint8,bytes4[])[],address,bytes"), [cuts.map((cut) => [cut.facetAddress, cut.action, cut.functionSelectors] as const), diamond, "0x1234"]), logIndex: 0 };

test("direct recovery binds exact hash, caller, destination, value and initializer calldata", () => {
  expect(verifyUpgradeTransaction(record, direct)).toEqual({ ok: true, value: "direct" });
  expect(verifyUpgradeEvidence(record, direct, receipt)).toEqual({ ok: true, value: { hash, status: "success", block: 2 } });
  for (const patch of [{ from: alice }, { to: safe }, { value: 1n }, { data: "0x12345678" as Hex }, { hash: `0x${"cd".repeat(32)}` as Hex }]) {
    expect(verifyUpgradeEvidence(record, { ...direct, ...patch }, receipt).ok).toBe(false);
  }
});

test("Safe recovery requires operation Call and the exact diamond input, then a successful cut event", () => {
  expect(verifyUpgradeTransaction(record, safeTx)).toEqual({ ok: true, value: "safe" });
  expect(verifyUpgradeEvidence(record, safeTx, receipt).ok).toBe(false);
  expect(verifyUpgradeEvidence(record, safeTx, { ...receipt, logs: [cutLog] }).ok).toBe(true);
  const delegate = { ...safeTx, data: encodeFunctionData({ abi: SAFE_EXEC_ABI, functionName: "execTransaction", args: [diamond, 0n, data, 1, 0n, 0n, 0n, diamond, diamond, "0x"] }) };
  expect(verifyUpgradeTransaction(record, delegate).ok).toBe(false);
  expect(verifyUpgradeEvidence(record, safeTx, { ...receipt, logs: [{ ...cutLog, address: safe }] }).ok).toBe(false);
});

test("a reverted exact direct or Safe attempt preserves the failed-attempt outcome", () => {
  expect(verifyUpgradeEvidence(record, direct, { ...receipt, status: "reverted" }).ok).toBe(true);
  expect(verifyUpgradeEvidence(record, safeTx, { ...receipt, status: "reverted" }).ok).toBe(true);
});

test("legacy intents cannot accept an arbitrary manual hash without exact saved calldata", () => {
  const { call: _call, ...legacy } = pending;
  expect(verifyUpgradeTransaction({ ...record, pendingUpgrade: legacy }, direct).ok).toBe(false);
});

test("router events alone cannot establish the actual caller through arbitrary retained code", () => {
  const event = parseAbi(["event UpgradeExecuted(address indexed executor,uint256 facetCutCount,address indexed init)"]);
  const executorLog = { address: diamond, topics: encodeEventTopics({ abi: event, eventName: "UpgradeExecuted", args: { executor: safe, init: diamond } }) as Hex[], data: encodeAbiParameters(parseAbiParameters("uint256"), [1n]), logIndex: 1 };
  const routed = { ...safeTx, to: alice, data: "0x12345678" as Hex };
  expect(verifyUpgradeEvidence(record, routed, { ...receipt, logs: [cutLog, executorLog] }).ok).toBe(false);
});

test("historical or same-block identical initializer-only calls cannot verify a fresh attempt", () => {
  const initOnly = encodeFunctionData({ abi: UPGRADE_ABI, functionName: "diamondCut", args: [[], diamond, "0x1234"] });
  const fresh = { ...record, pendingUpgrade: { ...pending, baseline: { ...pending.baseline, block: 100 }, call: { data: initOnly, value: "0" } } };
  for (const block of [50, 100]) {
    const result = verifyUpgradeEvidence(fresh, { ...direct, data: initOnly }, { ...receipt, block });
    expect(result.ok).toBe(false); if (!result.ok) expect(result.error).toContain("fresh baseline");
  }
  expect(verifyUpgradeEvidence(fresh, { ...direct, data: initOnly }, { ...receipt, block: 101 }).ok).toBe(true);
});
