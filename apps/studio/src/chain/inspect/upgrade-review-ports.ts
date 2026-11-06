import { err, ok, type Address, type Hex, type Result, type UpgradeCut } from "@lattice-studio/core";

export type UpgradeReviewDetails = {
  projectId: string;
  chainId: number;
  chainName: string;
  diamond: Address;
  from: Address;
  recipeHash: Hex;
  catalogHash: Hex;
  baselineBlock: number;
  observedBlock: number;
  cuts: readonly UpgradeCut[];
  init: { target: Address; data: Hex; steps: readonly string[] };
  authority: { kind: "owner" | "role" | "safe" | "custom"; explanation: string; canSign: boolean };
  opaque: readonly { kind: "foreign" | "self" | "extra"; label: string; address: Address; codehash: Hex; selectors: readonly Hex[] }[];
  requiresOpaqueAcknowledgement: boolean;
};

export type UpgradeReviewAcceptance = { accepted: boolean; opaqueAcknowledged: boolean };
export type UpgradeReviewPrompt = (details: UpgradeReviewDetails) => Promise<UpgradeReviewAcceptance>;
let prompt: UpgradeReviewPrompt | null = null;
export type UpgradePreparation = { projectId: string; recipeHash: Hex; status: "checking" | "error" | "idle"; reason?: string };
let preparation: UpgradePreparation | null = null;
const preparationListeners = new Set<() => void>();

export function getUpgradePreparation(): UpgradePreparation | null { return preparation; }
export function subscribeUpgradePreparation(listener: () => void): () => void { preparationListeners.add(listener); return () => { preparationListeners.delete(listener); }; }
export function setUpgradePreparation(next: UpgradePreparation | null): void {
  preparation = next;
  for (const listener of preparationListeners) listener();
}

/** The UI supplies the exact-cut/initializer/coverage review; this seam loads no wallet or chain code. */
export function setUpgradeReviewPrompt(next: UpgradeReviewPrompt): () => void {
  const previous = prompt;
  prompt = next;
  return () => { if (prompt === next) prompt = previous; };
}

export async function requestUpgradeReview(details: UpgradeReviewDetails): Promise<Result<UpgradeReviewAcceptance, string>> {
  if (prompt === null) return err("Upgrade review isn't available. Reload Studio and try again.");
  try { return ok(await prompt(details)); }
  catch { return err("Upgrade review was canceled."); }
}
