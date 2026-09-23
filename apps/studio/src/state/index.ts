/**
 * S1: state stores and document commands. The stores and `useAnalysis` are read through `@/contracts`; this
 * module adds the predicted address (`usePrediction`) and what other modules need to build on S1.
 */
import { useSyncExternalStore } from "react";
import type { Prediction } from "./prediction";
import { studioState } from "./runtime";

export { NEEDS_CATALOG, NEEDS_CHAIN, NEEDS_WALLET, predict } from "./prediction";
export type { Prediction } from "./prediction";
export { BLANK_DIAMOND } from "./cmd/recipe";
export { BURST_GAP_MS, HISTORY_LIMIT, isUnpinned, UNPINNED_HASH } from "./document-store";

function subscribePrediction(listener: () => void): () => void {
  return studioState().prediction.subscribe(listener);
}

/** The diamond's predicted address now, or why there's none. Non-reactive: for commands and services. */
export function prediction(): Prediction {
  return studioState().prediction.get();
}

/**
 * The diamond's predicted address for the selected chain, the project's path and salt and the connected account,
 * or why there's none yet ("Connect a wallet to see the deploy address (it depends on the deploying account)",
 * spec L365). Re-renders when it changes. S4d's title block and S8b's review show it.
 */
export function usePrediction(): Prediction {
  return useSyncExternalStore(subscribePrediction, prediction);
}
