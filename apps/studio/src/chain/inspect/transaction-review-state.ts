import type { Address, Result } from "@lattice-studio/core";
import type { Abi } from "viem";
import type { TransactionController, TransactionIntent } from "./transaction";
import type { CallOutput } from "./abi";

export type TransactionReviewRequest = {
  intent: TransactionIntent; label: string; abi: Abi; controller: TransactionController; invalidated: boolean;
  args: readonly CallOutput[];
  beforeSafeExport?(safe: Address): Promise<Result<void, string>>;
  onSafeExport?(safe: Address): Promise<Result<void, string>>;
};
let request: TransactionReviewRequest | null = null;
const listeners = new Set<() => void>();
export function getTransactionReview(): TransactionReviewRequest | null { return request; }
export function hasTransactionReview(): boolean { return request !== null; }
export function setTransactionReview(next: TransactionReviewRequest | null): void { request = next; for (const listener of listeners) listener(); }
export function subscribeTransactionReview(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; }

/** Editing inputs invalidates an unsent review. A submitted call keeps its captured watch. */
export function invalidateTransactionReview(): void {
  if (!request) return;
  const state = request.controller.get();
  if (state.hash || state.receipt || ["signing", "pending", "stale", "confirmed"].includes(state.phase)) return;
  request.controller.cancel();
  setTransactionReview({ ...request, invalidated: true });
}
