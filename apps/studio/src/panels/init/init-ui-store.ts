/**
 * The init editor's own state outside the document: which field's Confirm address… panel is open (LINK-01), and
 * the ENS names typed into address fields. Studio stores the resolved address in the recipe and keeps the name
 * as a label (spec L462); the recipe has no place for labels, so they live here for the session, keyed by
 * project and argument path.
 */
import type { Address } from "@lattice-studio/core";
import { useSyncExternalStore } from "react";

/** An ENS name typed into a field, with what it resolved to on which chain (spec L462: the selected chain's address). */
export type EnsLabel = { name: string; address: Address; chainId: number };

type State = {
  /** The argument path whose Confirm address… panel is open, per project id. */
  confirming: { projectId: string; path: string } | null;
  /** `${projectId}|${path}` → the ENS name, the address it resolved to and the chain it was resolved for. */
  labels: Readonly<Record<string, EnsLabel>>;
};

let state: State = { confirming: null, labels: {} };
const listeners = new Set<() => void>();

function set(patch: Partial<State>): void {
  state = { ...state, ...patch };
  for (const listener of Array.from(listeners)) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function openConfirm(projectId: string, path: string): void {
  set({ confirming: { projectId, path } });
}

export function closeConfirm(): void {
  if (state.confirming) set({ confirming: null });
}

export function confirmingPath(projectId: string): string | null {
  return state.confirming?.projectId === projectId ? state.confirming.path : null;
}

export function useConfirming(projectId: string): string | null {
  return useSyncExternalStore(subscribe, () => confirmingPath(projectId));
}

export function setEnsLabel(projectId: string, path: string, label: EnsLabel | null): void {
  const key = `${projectId}|${path}`;
  const { [key]: _dropped, ...rest } = state.labels;
  set({ labels: label ? { ...rest, [key]: label } : rest });
}

/**
 * The ENS name typed for `path`, while the field still holds the address it resolved to on the selected chain.
 * A name resolved for another chain says nothing about this one, so it isn't shown.
 */
export function ensLabel(projectId: string, path: string, value: unknown, chainId: number | null): string | null {
  const label = state.labels[`${projectId}|${path}`];
  if (!label || label.chainId !== chainId) return null;
  if (typeof value !== "string" || value.toLowerCase() !== label.address.toLowerCase()) return null;
  return label.name;
}

/** Drops every label resolved for a chain other than `chainId` (the chain changed: those names may point elsewhere). */
export function dropLabelsNotOn(chainId: number | null): void {
  const kept = Object.fromEntries(Object.entries(state.labels).filter(([, label]) => label.chainId === chainId));
  if (Object.keys(kept).length !== Object.keys(state.labels).length) set({ labels: kept });
}

export function useEnsLabels(): State["labels"] {
  return useSyncExternalStore(subscribe, () => state.labels);
}

/** @internal Tests: back to nothing open and no labels. */
export function resetInitUi(): void {
  set({ confirming: null, labels: {} });
}
