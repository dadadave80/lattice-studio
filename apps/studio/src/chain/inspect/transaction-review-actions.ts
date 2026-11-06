import { err, ok, type Address, type Result } from "@lattice-studio/core";
import type { Abi, AbiFunction } from "viem";
import { announce, chainService, log, openDialog, session } from "@/contracts";
import { transactionSnapshotIdentity, type TransactionController, type TransactionIntent } from "./transaction";
import { currentTransactionContextKey, getTransactionController } from "./transaction-runtime";
import { getTransactionReview, setTransactionReview } from "./transaction-review-state";
import { decodeCallInputs } from "./abi";

export type OpenTransactionReview = {
  intent: TransactionIntent; label: string; abi?: Abi; fn?: AbiFunction; controller?: TransactionController;
  beforeSafeExport?(safe: Address): Promise<Result<void, string>>;
  onSafeExport?(safe: Address): Promise<Result<void, string>>;
};

function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}

function openReviewDialog(): void {
  if (!session.get().dialogs.some((entry) => entry.id === "inspect-transaction")) openDialog("inspect-transaction");
}

/** Captures one request before asynchronous review. Opening, reviewing and exporting never send it. */
export async function openTransactionReview(input: OpenTransactionReview): Promise<Result<void, string>> {
  const previous = getTransactionReview();
  if (previous && ["signing", "pending", "stale"].includes(previous.controller.get().phase)) {
    openReviewDialog();
    return err("A transaction is already being tracked. Its progress is open.");
  }
  const controller = input.controller ?? getTransactionController();
  const intent = freeze(structuredClone({ ...input.intent, contextKey: input.intent.contextKey ?? currentTransactionContextKey() }));
  const beforeSafeExport = input.beforeSafeExport ?? (input.controller ? async () => err("Safe export isn't available for this review.") : async () => {
    if (currentTransactionContextKey() !== intent.contextKey) return err("The reviewed inputs changed. Review the call again.");
    try {
      const read = await (await chainService()).inspectDiamond(intent.chainId, intent.tx.to);
      if (!read.ok) return err(read.error.reason);
      if (currentTransactionContextKey() !== intent.contextKey || transactionSnapshotIdentity(read.value) !== transactionSnapshotIdentity(intent.snapshot)) {
        return err("The diamond changed. Refresh inspection and review the call again.");
      }
      return ok(undefined);
    } catch { return err("The diamond couldn't be checked. Retry the Safe export."); }
  });
  const decoded = input.fn ? decodeCallInputs(input.fn, intent.tx.data) : null;
  if (decoded && !decoded.ok) return err(decoded.error);
  setTransactionReview({ intent, label: input.label, abi: freeze(structuredClone(input.abi ?? [])), args: decoded?.ok ? freeze(decoded.value) : [], controller, invalidated: false, beforeSafeExport,
    ...(input.onSafeExport ? { onSafeExport: input.onSafeExport } : {}) });
  openReviewDialog();
  await controller.review(intent);
  return ok(undefined);
}

export function showTransactionProgress(): void {
  if (!getTransactionReview()) return;
  openReviewDialog();
  const text = "Opened transaction progress.";
  log({ tag: "Note", text }); announce(text);
}
