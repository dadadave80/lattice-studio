/**
 * The review's own state outside the document and the session: the address shown by Preview for another
 * account…, a pending "focus the chain picker" request (chain.focusPicker, IR L235) and the extra tick when the
 * RPC can't simulate (spec L573), which holds only for the snapshot it was ticked on. Light: the commands write it.
 */
import type { Address, Hex } from "@lattice-studio/core";
import { useSyncExternalStore } from "react";

export type AccountPreview = {
  /** The account previewed, checksummed. */
  account: Address;
  /** Where this diamond would deploy for it, or why it can't say. */
  result: { ok: true; address: Address; chainId: number } | { ok: false; reason: string };
};

type ReviewState = {
  preview: AccountPreview | null;
  /** Set by chain.focusPicker; the Network section focuses the picker and clears it. */
  focusPicker: boolean;
  /** The recipe hash the no-simulation tick was set on; null while unticked. */
  noSimulationTick: Hex | null;
  /** What the person typed into the mainnet confirmation (spec L573). */
  typedName: string;
};

const INITIAL: ReviewState = { preview: null, focusPicker: false, noSimulationTick: null, typedName: "" };
let state: ReviewState = INITIAL;
const listeners = new Set<() => void>();

function set(patch: Partial<ReviewState>): void {
  state = { ...state, ...patch };
  for (const listener of Array.from(listeners)) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function reviewState(): ReviewState {
  return state;
}

export function useReviewState<T>(select: (s: ReviewState) => T): T {
  return useSyncExternalStore(subscribe, () => select(state));
}

export function setPreview(preview: AccountPreview | null): void {
  set({ preview });
}

export function requestPickerFocus(): void {
  set({ focusPicker: true });
}

export function clearPickerFocus(): void {
  if (state.focusPicker) set({ focusPicker: false });
}

export function setTypedName(typedName: string): void {
  set({ typedName });
}

/** A fresh review: nothing previewed, no tick, nothing typed. A pending picker focus stays for the new review. */
export function beginReview(): void {
  set({ preview: null, noSimulationTick: null, typedName: "" });
}

export function setNoSimulationTick(hash: Hex | null): void {
  set({ noSimulationTick: hash });
}

/** @internal Tests: back to nothing previewed, no request, no tick. */
export function resetReviewState(): void {
  state = INITIAL;
  for (const listener of Array.from(listeners)) listener();
}
