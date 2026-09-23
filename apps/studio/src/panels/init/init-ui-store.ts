/**
 * The init editor's own state outside the document: which field's Confirm address… panel is open (LINK-01), and
 * the ENS names typed into address fields. Studio stores the resolved address in the recipe and keeps the name
 * as a label (spec L462); the recipe has no place for labels, so they live here for the session, keyed by
 * project and argument path.
 */
import type { Address } from "@lattice-studio/core";
import { useSyncExternalStore } from "react";

type State = {
  /** The argument path whose Confirm address… panel is open, per project id. */
  confirming: { projectId: string; path: string } | null;
  /** `${projectId}|${path}` → the ENS name and the address it resolved to. */
  labels: Readonly<Record<string, { name: string; address: Address }>>;
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

export function setEnsLabel(projectId: string, path: string, label: { name: string; address: Address } | null): void {
  const key = `${projectId}|${path}`;
  const { [key]: _dropped, ...rest } = state.labels;
  set({ labels: label ? { ...rest, [key]: label } : rest });
}

/** The ENS name typed for `path`, while the field still holds the address it resolved to. */
export function ensLabel(projectId: string, path: string, value: unknown): string | null {
  const label = state.labels[`${projectId}|${path}`];
  if (!label || typeof value !== "string" || value.toLowerCase() !== label.address.toLowerCase()) return null;
  return label.name;
}

export function useEnsLabels(): State["labels"] {
  return useSyncExternalStore(subscribe, () => state.labels);
}

/** @internal Tests: back to nothing open and no labels. */
export function resetInitUi(): void {
  set({ confirming: null, labels: {} });
}
