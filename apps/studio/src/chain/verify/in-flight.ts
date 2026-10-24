/**
 * Verification jobs running now, one entry per record and leg, shared by the watcher and Retry verification so
 * neither submits the same job twice. Kept in a store so the Deployments list can say "Verifying on Etherscan"
 * exactly while a job is running, never because a key exists.
 *
 * Light: the Deployments list reads it, so nothing here imports the Etherscan client or the verify engine.
 */
import type { Deployment } from "@lattice-studio/core";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

export type VerifyLeg = "sourcify" | "etherscan";

type Target = Pick<Deployment, "chainId" | "address">;

function keyOf(target: Target, leg: VerifyLeg): string {
  return `${target.chainId}:${target.address.toLowerCase()}:${leg}`;
}

const store = createStore<ReadonlySet<string>>(() => new Set());

export const verifyJobs = {
  has(target: Target, leg: VerifyLeg): boolean {
    return store.getState().has(keyOf(target, leg));
  },
  add(target: Target, leg: VerifyLeg): void {
    store.setState(new Set(store.getState()).add(keyOf(target, leg)), true);
  },
  delete(target: Target, leg: VerifyLeg): void {
    const next = new Set(store.getState());
    next.delete(keyOf(target, leg));
    store.setState(next, true);
  },
  subscribe(listener: () => void): () => void {
    return store.subscribe(listener);
  },
};

/** Whether Etherscan's job for this diamond is running now, for render. */
export function useEtherscanInFlight(target: Target): boolean {
  const key = keyOf(target, "etherscan");
  return useStore(store, (state) => state.has(key));
}
