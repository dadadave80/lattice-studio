import { expect, test } from "bun:test";
import type { Deployment, PendingUpgrade, UpgradeBaseline } from "../model/project";
import { prepareUpgradeRecord, settleUpgradeRecord } from "./records";

const address = "0x0000000000000000000000000000000000000011";
const hash = `0x${"ab".repeat(32)}` as const;
const nextHash = `0x${"cd".repeat(32)}` as const;
const tx = `0x${"ef".repeat(32)}` as const;
const observed: UpgradeBaseline = { block: 101, blockHash: hash,
  facets: [{ facetAddress: address, functionSelectors: ["0x12345678"] }], codehashes: { [address]: hash } };
const original: Deployment = { kind: "imported", projectId: "original-project", chainId: 11155111, address,
  status: "confirmed", block: 100, recipeHash: hash, catalogHash: hash, at: "2026-11-06T00:00:00Z", revision: 4, verification: "failed" };
const pending: PendingUpgrade = { phase: "pending", desiredRecipeHash: nextHash, catalogHash: nextHash, baseline: { ...observed, block: 100 },
  expectedFacets: observed.facets, expectedCodehashes: observed.codehashes, from: address, since: "2026-11-06T00:01:00Z", tx };

test("pending upgrades preserve the last confirmed record and its original owner", () => {
  const prepared = prepareUpgradeRecord(original, pending);
  expect(prepared.ok).toBe(true);
  if (!prepared.ok) return;
  const { pendingUpgrade, ...settled } = prepared.value;
  expect(pendingUpgrade).toEqual(pending);
  expect(settled).toEqual(original);
  expect(original).not.toHaveProperty("pendingUpgrade");
  expect(prepareUpgradeRecord(prepared.value, pending).ok).toBe(false);
  expect(prepareUpgradeRecord({ ...original, fromFile: true }, pending).ok).toBe(false);
});

test("a reverted receipt clears only the pending intent", () => {
  const record = { ...original, pendingUpgrade: pending };
  const result = settleUpgradeRecord(record, { hash: tx, status: "reverted", block: 101 });
  expect(result).toEqual({ ok: true, value: original });
  expect(record.pendingUpgrade).toEqual(pending);
});

test("an old identical initializer transaction cannot confirm or clear a new reservation", () => {
  const record = { ...original, pendingUpgrade: pending };
  for (const block of [50, 100]) for (const status of ["success", "reverted"] as const) {
    expect(settleUpgradeRecord(record, { hash: tx, status, block }, observed).ok).toBe(false);
  }
  expect(record.revision).toBe(4);
  expect(record.pendingUpgrade).toBe(pending);
});

test("only a matching receipt plus exact routing and runtime verifies an upgrade", () => {
  const record = { ...original, pendingUpgrade: pending };
  const receipt = { hash: tx, status: "success", block: 101 } as const;
  expect(settleUpgradeRecord(record, receipt).ok).toBe(false);
  expect(settleUpgradeRecord(record, { ...receipt, hash }).ok).toBe(false);
  expect(settleUpgradeRecord(record, receipt, { ...observed, block: 100 }).ok).toBe(false);
  expect(settleUpgradeRecord(record, receipt, { ...observed, facets: [] }).ok).toBe(false);
  expect(settleUpgradeRecord(record, receipt, { ...observed, codehashes: { [address]: nextHash } }).ok).toBe(false);
  const verified = settleUpgradeRecord(record, receipt, observed);
  expect(verified).toEqual({ ok: true, value: { ...original, recipeHash: nextHash, catalogHash: nextHash, revision: 5 } });
  if (verified.ok) expect(settleUpgradeRecord(verified.value, receipt, observed)).toEqual(verified);
  const imported = settleUpgradeRecord({ ...record, fromFile: true }, receipt, observed);
  expect(imported).toEqual(verified);
  expect(settleUpgradeRecord({ ...record, fromFile: true }, { ...receipt, status: "reverted" })).toEqual({ ok: true, value: { ...original, fromFile: true } });
});

test("duplicate observed selectors and missing expected target code cannot pass verification", () => {
  const receipt = { hash: tx, status: "success", block: 101 } as const;
  expect(settleUpgradeRecord({ ...original, pendingUpgrade: pending }, receipt, { ...observed, facets: [...observed.facets, ...observed.facets] }).ok).toBe(false);
  expect(prepareUpgradeRecord(original, { ...pending, expectedCodehashes: {} }).ok).toBe(false);
  const { tx: _tx, ...proposal } = pending;
  const proposed = prepareUpgradeRecord(original, { ...proposal, phase: "proposed" });
  expect(proposed.ok).toBe(true);
  if (proposed.ok) expect(settleUpgradeRecord(proposed.value, receipt, observed).ok).toBe(false);
  const reserved = prepareUpgradeRecord(original, { ...proposal, phase: "signing", reviewId: "review-a" });
  expect(reserved.ok).toBe(true);
  if (reserved.ok) expect(settleUpgradeRecord(reserved.value, receipt, observed).ok).toBe(false);
});
