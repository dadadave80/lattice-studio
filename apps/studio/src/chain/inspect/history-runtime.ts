import type { Result } from "@lattice-studio/core";
import { chainService } from "@/contracts";
import { getInspectionEngine } from "./app";
import { createHistoryController, type HistoryController } from "./history-state";

export type { HistoryController, HistoryReadInput, HistoryState, HistoryTarget } from "./history-state";
export { createHistoryController } from "./history-state";

let token = "";
const tokenListeners = new Set<() => void>();
let history: HistoryController | null = null;

/** Deliberately memory-only: never a setting, environment value, export, cache key or persisted preference. */
export function getHyperRpcToken(): string { return token; }
export function setHyperRpcToken(input: string): Result<void, string> {
  const value = input.trim();
  if (value.length > 1024 || [...value].some((character) => character.charCodeAt(0) < 33 || character.charCodeAt(0) > 126)) {
    return { ok: false, error: "Enter an API token without spaces or control characters." };
  }
  if (value !== token) {
    token = value;
    history?.cancel();
    for (const listener of tokenListeners) listener();
  }
  return { ok: true, value: undefined };
}
export function subscribeHyperRpcToken(listener: () => void): () => void { tokenListeners.add(listener); return () => { tokenListeners.delete(listener); }; }

export function getHistoryController(): HistoryController {
  history ??= createHistoryController({
    read: async (target, input, signal) => (await chainService()).cutHistory(target.chainId, target.address, {
      toBlock: target.block, blockHash: target.blockHash, signal,
      ...(input.fromBlock === undefined ? {} : { fromBlock: input.fromBlock }),
      ...(input.provider === "hyperrpc" ? { token: getHyperRpcToken() } : {}),
    }),
    attach: (target, value) => getInspectionEngine().attachHistory(target, value, target.identity),
  });
  return history;
}
