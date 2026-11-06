import { err, ok, prepareUpgradeRecord, sameAddress, settleUpgradeRecord, type Address, type Deployment, type Hex, type PendingUpgrade, type Result, type TxRequest, type UpgradeBaseline, type UpgradeOrigin, type UpgradeReceipt } from "@lattice-studio/core";
import type { ReceiptOutcome } from "../deploy/ports";
import type { DiamondSnapshot } from "./snapshot";
import type { TransactionReview } from "./transaction";
import { checkUpgradeBaseline } from "./upgrade-preflight";

export type UpgradeRecordIntent = {
  origin: UpgradeOrigin;
  recipeHash: Hex;
  catalogHash: Hex;
  tx: TxRequest;
  expectedFacets: UpgradeBaseline["facets"];
  expectedCodehashes: UpgradeBaseline["codehashes"];
};
export type UpgradeRecordPorts = {
  update(chainId: number, address: Address, update: (current: Deployment | null) => Result<Deployment, string>): Promise<Result<Deployment, string>>;
  now(): number;
  reviewId(): string;
};

/** All writes bind the original record owner and reservation; no callback reads whichever document is open. */
export function createUpgradeRecordTracker(input: UpgradeRecordIntent, original: Deployment, ports: UpgradeRecordPorts) {
  const intent = structuredClone(input);
  const captured = structuredClone(original);
  const attempts = new WeakMap<TransactionReview, string>();
  const proposals = new Map<string, string>();
  const atTarget = (update: (current: Deployment) => Result<Deployment, string>) => ports.update(intent.origin.chainId, intent.origin.address, (current) => {
    if (!current || current.projectId !== captured.projectId || current.chainId !== captured.chainId || !sameAddress(current.address, captured.address)) return err("The original deployment record changed or disappeared. Its upgrade tracking wasn't overwritten.");
    return update(current);
  });
  const pending = (phase: PendingUpgrade["phase"], reviewId: string, from: Address, baseline: UpgradeBaseline): PendingUpgrade => ({
    phase, reviewId, from, since: new Date(ports.now()).toISOString(), baseline,
    desiredRecipeHash: intent.recipeHash, catalogHash: intent.catalogHash,
    expectedFacets: intent.expectedFacets, expectedCodehashes: intent.expectedCodehashes,
    call: { data: intent.tx.data, value: intent.tx.value.toString() },
  });
  const reserve = (next: PendingUpgrade) => atTarget((current) => {
    if (current.revision !== captured.revision || current.recipeHash.toLowerCase() !== captured.recipeHash.toLowerCase() || current.catalogHash.toLowerCase() !== captured.catalogHash.toLowerCase()) {
      return err("The confirmed deployment revision changed. Prepare the upgrade again.");
    }
    if (current.pendingUpgrade !== undefined) {
      return current.pendingUpgrade.reviewId === next.reviewId && current.pendingUpgrade.phase === next.phase
        ? ok(current) : err("This diamond already has an unresolved upgrade. Check its outcome first.");
    }
    // The caller supplied a fresh, origin-matching coherent snapshot. Creation provenance stays data;
    // neither a stored owner nor a stored deployment path is used as the live upgrade authorization.
    const { fromFile: _fromFile, ...reread } = current;
    return prepareUpgradeRecord(reread, next);
  });
  const need = async (result: Promise<Result<Deployment, string>>): Promise<void> => { const saved = await result; if (!saved.ok) throw new Error(saved.error); };

  return {
    async reserve(review: TransactionReview): Promise<Result<Deployment, string>> {
      if (review.chainId !== intent.origin.chainId || !sameAddress(review.tx.to, intent.origin.address) || review.tx.data.toLowerCase() !== intent.tx.data.toLowerCase() || review.tx.value !== intent.tx.value) return err("The reviewed transaction doesn't match the captured upgrade intent.");
      const baseline = checkUpgradeBaseline(intent.origin, review.snapshot);
      if (!baseline.ok) return baseline;
      const id = attempts.get(review) ?? ports.reviewId();
      attempts.set(review, id);
      return reserve(pending("signing", id, review.from, baseline.value));
    },
    async unsent(review: TransactionReview): Promise<void> {
      const id = attempts.get(review);
      if (!id) return;
      await need(atTarget((current) => {
        const own = current.pendingUpgrade;
        if (own?.reviewId !== id || own.phase !== "signing" || own.tx !== undefined) return ok(current);
        const { pendingUpgrade: _pending, ...confirmed } = current;
        return ok(confirmed);
      }));
    },
    async sent(review: TransactionReview, hash: Hex): Promise<void> {
      const id = attempts.get(review);
      if (!id) throw new Error("The upgrade's wallet reservation is unavailable. Keep its transaction hash.");
      await need(atTarget((current) => {
        if (current.pendingUpgrade?.reviewId !== id) return err("Another upgrade owns this record. Keep the sent transaction hash for recovery.");
        return ok({ ...current, pendingUpgrade: { ...current.pendingUpgrade, phase: "pending", tx: hash } });
      }));
    },
    async receipt(review: TransactionReview, receipt: ReceiptOutcome): Promise<"verify" | "done"> {
      if (receipt.kind === "aborted") return "done";
      const id = attempts.get(review);
      if (!id) throw new Error("The upgrade's tracking reservation is unavailable.");
      await need(atTarget((current) => {
        if (current.pendingUpgrade === undefined) return ok(current);
        if (current.pendingUpgrade.reviewId !== id) return err("Another upgrade owns this record. Its outcome wasn't overwritten.");
        if (receipt.kind === "replaced") { const { pendingUpgrade: _pending, ...confirmed } = current; return ok(confirmed); }
        if (current.pendingUpgrade.tx?.toLowerCase() !== receipt.hash.toLowerCase()) return err("This receipt doesn't match the tracked upgrade hash.");
        if (receipt.status === "reverted") return settleUpgradeRecord(current, receipt);
        return ok({ ...current, pendingUpgrade: { ...current.pendingUpgrade, phase: "verifying" } });
      }));
      return receipt.kind === "receipt" && receipt.status === "success" ? "verify" : "done";
    },
    verified(review: TransactionReview, receipt: UpgradeReceipt, observed: UpgradeBaseline): Promise<Result<Deployment, string>> {
      const id = attempts.get(review);
      return atTarget((current) => {
        if (current.pendingUpgrade === undefined) return ok(current);
        if (!id || current.pendingUpgrade.reviewId !== id) return err("Another upgrade owns this record. Its revision wasn't overwritten.");
        return settleUpgradeRecord(current, receipt, observed);
      });
    },
    async propose(from: Address, snapshot: DiamondSnapshot): Promise<Result<Deployment, string>> {
      const baseline = checkUpgradeBaseline(intent.origin, snapshot);
      if (!baseline.ok) return baseline;
      const key = from.toLowerCase();
      const id = proposals.get(key) ?? ports.reviewId();
      proposals.set(key, id);
      return reserve(pending("proposed", id, from, baseline.value));
    },
  };
}
