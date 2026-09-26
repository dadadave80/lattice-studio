/**
 * The init editor's own state outside the document: which field's Confirm address… panel is open (LINK-01), and
 * the ENS names typed into address fields (spec L462: Studio stores the resolved address and keeps the name as a
 * label).
 *
 * A label has two sources. The project keeps the name (`Project.labels`, by argument path), so it survives a reload
 * and travels in the project file; the address commit writes it in the same undo step (`setAddressOp`). This store
 * also remembers, for the session, what each name resolved to and on which chain: that entry wins for its field,
 * so a name typed for one chain isn't shown on another, and a field that no longer holds the address its name
 * resolved to (after an undo) shows no name. A label read from the project alone (after a reload) names the
 * address its field holds, for the selected chain; the deploy review re-resolves it there and flags any change.
 *
 * This module is on the first load (commands.ts): it reads the stores through the contracts only.
 */
import type { Address, Project, RecipeInit } from "@lattice-studio/core";
import { useSyncExternalStore } from "react";
import { doc, session } from "@/contracts";
import { addressAt, sameAddress } from "./init-paths";

/** An ENS name typed into a field, with what it resolved to on which chain (spec L462: the selected chain's address). */
export type EnsLabel = { name: string; address: Address; chainId: number };

type State = {
  /** The argument path whose Confirm address… panel is open, per project id. */
  confirming: { projectId: string; path: string } | null;
  /** `${projectId}|${path}` → the ENS name, the address it resolved to and the chain it was resolved for, this session. */
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

/** Records (or with null, forgets) what the name typed at `path` resolved to, for this session. */
export function setEnsLabel(projectId: string, path: string, label: EnsLabel | null): void {
  const key = `${projectId}|${path}`;
  if (!label && !(key in state.labels)) return;
  const { [key]: _dropped, ...rest } = state.labels;
  set({ labels: label ? { ...rest, [key]: label } : rest });
}

type Inputs = {
  session: State["labels"];
  projectId: string;
  stored: Project["labels"];
  init: RecipeInit;
  chainId: number | null;
};

let last: { inputs: Inputs; labels: Readonly<Record<string, EnsLabel>> } | null = null;

function sameInputs(a: Inputs, b: Inputs): boolean {
  return a.session === b.session && a.projectId === b.projectId && a.stored === b.stored && a.init === b.init && a.chainId === b.chainId;
}

/**
 * Every ENS label, keyed `${projectId}|${path}`: this session's entries, then the open project's stored names for
 * fields that have none, as the address the field holds on the selected chain. The same object until an input changes.
 */
export function ensLabels(): Readonly<Record<string, EnsLabel>> {
  const project = doc.get();
  const inputs: Inputs = {
    session: state.labels,
    projectId: project.id,
    stored: project.labels,
    init: project.recipe.init,
    chainId: session.get().chainId,
  };
  if (last && sameInputs(last.inputs, inputs)) return last.labels;
  let labels: Readonly<Record<string, EnsLabel>> = inputs.session;
  if (inputs.stored && inputs.chainId !== null) {
    const derived: Record<string, EnsLabel> = {};
    for (const [path, name] of Object.entries(inputs.stored)) {
      const key = `${inputs.projectId}|${path}`;
      if (key in inputs.session) continue;
      const address = addressAt(inputs.init, path);
      if (address) derived[key] = { name, address, chainId: inputs.chainId };
    }
    if (Object.keys(derived).length > 0) labels = { ...inputs.session, ...derived };
  }
  last = { inputs, labels };
  return labels;
}

/**
 * The ENS name typed for `path`, while the field still holds the address it resolved to on the selected chain.
 * A name resolved for another chain says nothing about this one, so it isn't shown.
 */
export function ensLabel(projectId: string, path: string, value: unknown, chainId: number | null): string | null {
  const label = ensLabels()[`${projectId}|${path}`];
  if (!label || label.chainId !== chainId) return null;
  if (typeof value !== "string" || !sameAddress(value, label.address)) return null;
  return label.name;
}

/** The name the open project stores for `path` (its label, whichever chain is selected), or null. */
export function storedLabel(path: string): string | null {
  return doc.get().labels?.[path] ?? null;
}

function subscribeAll(listener: () => void): () => void {
  const stops = [subscribe(listener), doc.subscribe(listener), session.subscribe(listener)];
  return () => {
    for (const stop of stops) stop();
  };
}

export function useEnsLabels(): Readonly<Record<string, EnsLabel>> {
  return useSyncExternalStore(subscribeAll, ensLabels);
}

/** @internal Tests: back to nothing open and no labels typed this session. */
export function resetInitUi(): void {
  set({ confirming: null, labels: {} });
}
