import type { PassportCutEvent } from "./types";

/** Cut events in chain order: by block, then by log index. */
export function sortCuts(cuts: readonly PassportCutEvent[]): PassportCutEvent[] {
  return [...cuts].sort((a, b) => a.block - b.block || a.logIndex - b.logIndex);
}

/** The deployment's own cuts (every cut in the earliest cut's transaction) and the upgrades after them. */
export function summarizeHistory(cuts: readonly PassportCutEvent[]): { deploymentTx: PassportCutEvent["txHash"] | null; initial: PassportCutEvent[]; later: PassportCutEvent[] } {
  const sorted = sortCuts(cuts);
  const first = sorted[0];
  if (first === undefined) return { deploymentTx: null, initial: [], later: [] };
  const tx = first.txHash.toLowerCase();
  return {
    deploymentTx: first.txHash,
    initial: sorted.filter((cut) => cut.txHash.toLowerCase() === tx),
    later: sorted.filter((cut) => cut.txHash.toLowerCase() !== tx),
  };
}
