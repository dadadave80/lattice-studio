import type { Hex } from "../model/hex";
import { toLowerHex } from "../model/hex";
import type { Deployment, PendingUpgrade, UpgradeBaseline } from "../model/project";
import { err, ok, type Result } from "../model/result";
import { validateDeployment } from "../model/schema";
import { compareRouting, differenceCount } from "../passport/compare";
import { buildUpgradeCuts } from "./cuts";

/** Attach intent while retaining the last confirmed hash, revision and creation provenance. */
export function prepareUpgradeRecord(record: Deployment, pendingUpgrade: PendingUpgrade): Result<Deployment, string> {
  if (record.status !== "confirmed" || record.fromFile === true) return err("Re-read a confirmed deployment before preparing its upgrade.");
  if (record.pendingUpgrade !== undefined) return err("This diamond already has an unresolved upgrade. Check its outcome first.");
  if (pendingUpgrade.phase !== "proposed" && pendingUpgrade.phase !== "signing" && pendingUpgrade.tx === undefined && pendingUpgrade.callsId === undefined) {
    return err("A pending upgrade needs its transaction hash or wallet calls id.");
  }
  const checked = validateDeployment({ ...record, pendingUpgrade });
  if (!checked.ok) return err("The upgrade record is incomplete or malformed.");
  const pending = checked.value.value.pendingUpgrade!;
  const expected = new Set([record.address.toLowerCase(), ...pending.expectedFacets.map((row) => row.facetAddress.toLowerCase())]);
  const hashes = new Set(Object.keys(pending.expectedCodehashes).map((address) => address.toLowerCase()));
  if ([...expected].some((address) => !hashes.has(address))) return err("The upgrade record needs runtime hashes for the diamond and every expected facet.");
  return ok(checked.value.value);
}

export type UpgradeReceipt = { hash: Hex; status: "success" | "reverted"; block: number };

/** A receipt alone cannot advance a revision; both routed selectors and runtime code must match. */
export function settleUpgradeRecord(record: Deployment, receipt: UpgradeReceipt, observed?: UpgradeBaseline): Result<Deployment, string> {
  const valid = validateDeployment(record);
  if (!valid.ok) return err("The saved upgrade record is malformed.");
  const pending = record.pendingUpgrade;
  if (!pending) return ok(record);
  if (pending.tx === undefined || pending.tx.toLowerCase() !== receipt.hash.toLowerCase()) return err("This receipt doesn't belong to the pending upgrade.");
  if (!Number.isSafeInteger(receipt.block) || receipt.block <= pending.baseline.block) return err("The upgrade receipt must be newer than its saved preflight baseline.");
  const { pendingUpgrade: _pending, ...confirmed } = record;
  if (receipt.status === "reverted") return ok(confirmed);
  if (!observed || !Number.isSafeInteger(receipt.block) || receipt.block < 0 || observed.block < receipt.block) {
    return err("Read the diamond at or after the upgrade receipt before confirming it.");
  }
  if (!validateDeployment({ ...record, pendingUpgrade: { ...pending, baseline: observed } }).ok) return err("The observed upgrade snapshot is malformed.");
  const checked = buildUpgradeCuts({ diamond: record.address, current: observed.facets, desired: observed.facets, locked: [] });
  if (!checked.ok) return err("The observed upgrade routing is malformed.");
  const diff = compareRouting(pending.expectedFacets.map((row) => ({ facet: row.facetAddress, address: row.facetAddress, selectors: row.functionSelectors })), observed.facets);
  if (differenceCount(diff) !== 0) return err("The observed routing doesn't match the pending upgrade. Its previous revision is still recorded.");
  const hashes = new Map(Object.entries(observed.codehashes).map(([address, hash]) => [address.toLowerCase(), hash.toLowerCase()]));
  const required = new Set([record.address.toLowerCase(), ...pending.expectedFacets.map((row) => row.facetAddress.toLowerCase())]);
  const expected = new Map(Object.entries(pending.expectedCodehashes).map(([address, hash]) => [address.toLowerCase(), hash.toLowerCase()]));
  if ([...required].some((address) => !expected.has(address)) || [...expected].some(([address, hash]) => hashes.get(address) !== hash)) {
    return err("The observed runtime code doesn't match the pending upgrade. Its previous revision is still recorded.");
  }
  const { fromFile: _fromFile, ...reread } = confirmed;
  const next = { ...reread, recipeHash: toLowerHex(pending.desiredRecipeHash), catalogHash: toLowerHex(pending.catalogHash), revision: record.revision + 1 };
  return validateDeployment(next).ok ? ok(next) : err("The verified upgrade revision can't be stored.");
}
