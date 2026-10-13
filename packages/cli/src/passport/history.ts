import type { CutEvent } from "./types";

/** Cut events in chain order: by block, then by log index. */
export function sortCuts(cuts: readonly CutEvent[]): CutEvent[] {
  return [...cuts].sort((a, b) => a.block - b.block || a.logIndex - b.logIndex);
}

/** The deployment's own cuts (every cut in the earliest cut's transaction) and the upgrades after them. */
export function summarizeHistory(cuts: readonly CutEvent[]): { deploymentTx: CutEvent["txHash"] | null; initial: CutEvent[]; later: CutEvent[] } {
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
