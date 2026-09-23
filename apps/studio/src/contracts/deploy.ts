/**
 * The deploy controller (contracts §5.2 "deploy"): Flow 12's state machine (spec L532-L557), implemented by
 * S8c and read by S8b (review), S4d (title block), S3 (status chip) and S5e (console summary). K2's default
 * stays `idle` and logs `Not built yet · WP-S8c` for every call.
 *
 * The state is mirrored here, so `useDeployState` and `deployState()` read it without loading S8c's lazy
 * chunk; it reads `idle` until something calls `deployController()` (S8c calls it itself to resume after a
 * reload).
 */
import type { Address, Hex } from "@lattice-studio/core";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { log } from "./kernel";
import { listenerSet } from "./relay";

export type DeployPhase =
  | "idle" | "review" | "simulating" | "ready" | "awaitingSignature" | "pending" | "stale"
  | "proposed" | "confirmed" | "verifying" | "live" | "mismatch" | "failed";

export type DeployState = {
  phase: DeployPhase;
  /** The recipe hash the review opened with. */
  snapshot?: Hex;
  changedSinceReview?: boolean;
  chainId?: number;
  address?: Address;
  /** The deploying account. */
  from?: Address;
  /** The Safe a proposal waits on: "Proposed to Safe 0x71C7…976F on Sepolia" (spec L385). */
  safe?: Address;
  tx?: Hex;
  since?: string;
  simulation?: { ok: boolean; block?: number; summary?: string; revert?: string };
  /** The missing-contracts sub-step. */
  missing?: { name: string; status: "pending" | "deployed" | "failed" }[];
  /** The spec's message for the current failure. */
  error?: string;
};

export type DeployController = {
  state(): DeployState;
  subscribe(fn: (s: DeployState) => void): () => void;
  /** Deploy…: snapshot, then Review. */
  open(): void;
  /** Recipe, account or chain changed: simulate again. */
  changed(): void;
  sign(): Promise<void>;
  /** A Safe batch was downloaded (review or Export): save the record as Proposed. */
  proposed(batch: { safe: Address; chainId: number; address: Address; salt: Hex }): void;
  deployMissing(names: string[]): Promise<void>;
  keepWaiting(): void;
  checkWallet(): void;
  reviewAgain(): void;
  discardProposal(): void;
  retry(): void;
  close(): void;
};

const IDLE: DeployState = Object.freeze({ phase: "idle" });

function notBuilt(): void {
  log({ tag: "Note", text: "Not built yet · WP-S8c" });
}

function idleController(): DeployController {
  return {
    state: () => IDLE,
    subscribe: () => () => {},
    open: notBuilt,
    changed: notBuilt,
    sign: async () => notBuilt(),
    proposed: notBuilt,
    deployMissing: async () => notBuilt(),
    keepWaiting: notBuilt,
    checkWallet: notBuilt,
    reviewAgain: notBuilt,
    discardProposal: notBuilt,
    retry: notBuilt,
    close: notBuilt,
  };
}

const mirror = createStore<{ state: DeployState }>(() => ({ state: IDLE }));
const mirrorListeners = listenerSet<(state: DeployState) => void>();
mirror.subscribe((s, p) => {
  if (s.state !== p.state) mirrorListeners.emit(s.state);
});

const defaultLoader = async () => idleController();
let loader: () => Promise<DeployController> = defaultLoader;
let loading: Promise<DeployController> | null = null;
let unsubscribe: (() => void) | null = null;
/** Bumped by every reset, so a load that started before one never touches the mirror after it. */
let generation = 0;

function detach(): void {
  generation += 1;
  unsubscribe?.();
  unsubscribe = null;
  loading = null;
  mirror.setState({ state: IDLE });
}

/** The controller, loading its lazy chunk on first call. A failed load is retried on the next call. */
export function deployController(): Promise<DeployController> {
  if (loading) return loading;
  const started = generation;
  const attempt = loader().then(
    (controller) => {
      // A reset (detach, seedDeployState, a new provideDeployController) ran while this loaded: leave the mirror alone.
      if (started !== generation) return controller;
      unsubscribe?.();
      mirror.setState({ state: controller.state() });
      unsubscribe = controller.subscribe((state) => mirror.setState({ state }));
      return controller;
    },
    (error: unknown) => {
      if (loading === attempt) loading = null;
      throw error;
    },
  );
  loading = attempt;
  return attempt;
}

/** The deploy state now, for `enabled()` reasons and other non-render code. `idle` until the controller loads. */
export function deployState(): DeployState {
  return mirror.getState().state;
}

/** Reads the deploy state through a narrow selector; `idle` until the controller loads. */
export function useDeployState<T>(selector: (state: DeployState) => T): T {
  return useStore(mirror, (s) => selector(s.state));
}

/** Subscribes to the deploy state outside React. */
export function subscribeDeployState(listener: (state: DeployState) => void): () => void {
  return mirrorListeners.add(listener);
}

/**
 * S8c registers its controller's loader (`() => import("./controller").then(...)`) at module evaluation.
 * Returns a disposer that restores the previous loader, unsubscribes and resets the mirror to `idle`.
 */
export function provideDeployController(load: () => Promise<DeployController>): () => void {
  const previous = loader;
  detach();
  loader = load;
  return () => {
    if (loader !== load) return;
    detach();
    loader = previous;
  };
}

/**
 * @internal Tests: drops the loaded controller and its subscription and sets the mirror to `state`
 * (default `idle`); the registered loader stays. Returns a disposer that resets again.
 */
export function seedDeployState(state: DeployState = IDLE): () => void {
  generation += 1;
  unsubscribe?.();
  unsubscribe = null;
  loading = null;
  mirror.setState({ state });
  return detach;
}

/** @internal Contract tests: K2's idle loader. Returns a disposer that restores the previous loader. */
export function resetDeploy(): () => void {
  const previous = loader;
  detach();
  loader = defaultLoader;
  return () => {
    detach();
    loader = previous;
  };
}
