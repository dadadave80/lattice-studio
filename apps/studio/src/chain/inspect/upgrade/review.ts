import { closeDialog, openDialog, session } from "@/contracts";
import type { UpgradeReviewAcceptance, UpgradeReviewDetails } from "../upgrade-review-ports";

type Request = { details: UpgradeReviewDetails; resolve(value: UpgradeReviewAcceptance): void };
let request: Request | null = null;
const listeners = new Set<() => void>();
export function getUpgradeReview(): Request | null { return request; }
export function subscribeUpgradeReview(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; }

export function finishUpgradeReview(value: UpgradeReviewAcceptance): void {
  const captured = request;
  if (!captured) return;
  request = null;
  closeDialog("upgrade-plan-review");
  for (const listener of listeners) listener();
  captured.resolve(value);
}

/** The runtime owns the captured immutable details and revalidates after this explicit review. */
export function openUpgradeReview(details: UpgradeReviewDetails): Promise<UpgradeReviewAcceptance> {
  finishUpgradeReview({ accepted: false, opaqueAcknowledged: false });
  const result = new Promise<UpgradeReviewAcceptance>((resolve) => { request = { details, resolve }; });
  for (const listener of listeners) listener();
  if (!session.get().dialogs.some((entry) => entry.id === "upgrade-plan-review")) openDialog("upgrade-plan-review");
  return result;
}
