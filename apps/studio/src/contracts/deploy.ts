/**
 * The deploy controller (contracts §5.2 "deploy"): Flow 12's state machine (spec L532-L557), implemented by
 * S8c and read by S8b (review), S4d (title block), S3 (status chip) and S5e (console summary). K2's default
 * stays `idle` and logs `Not built yet · WP-S8c` for every call.
 */
import type { Address, Hex } from "@lattice-studio/core";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { log, now } from "./services";

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
  log({ tag: "Note", text: "Not built yet · WP-S8c", at: new Date(now()).toISOString() });
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

/** Mirrors the loaded controller's state, so `useDeployState` renders before and after it loads. */
const mirror = createStore<{ state: DeployState }>(() => ({ state: IDLE }));

let loader: () => Promise<DeployController> = async () => idleController();
let loading: Promise<DeployController> | null = null;
let unsubscribe: (() => void) | null = null;

/** The controller, loading its lazy chunk on first call. */
export function deployController(): Promise<DeployController> {
  loading ??= loader().then((controller) => {
    unsubscribe?.();
    mirror.setState({ state: controller.state() });
    unsubscribe = controller.subscribe((state) => mirror.setState({ state }));
    return controller;
  });
  return loading;
}

/** Reads the deploy state through a narrow selector; `idle` until the controller loads. */
export function useDeployState<T>(selector: (state: DeployState) => T): T {
  return useStore(mirror, (s) => selector(s.state));
}

/**
 * S8c registers its controller's loader (`() => import("./controller").then(...)`) at module evaluation.
 * Returns a disposer that restores the previous loader.
 */
export function provideDeployController(load: () => Promise<DeployController>): () => void {
  const previous = loader;
  loader = load;
  loading = null;
  return () => {
    if (loader !== load) return;
    loader = previous;
    loading = null;
  };
}

/** @internal The harness's reset between tests. */
export function resetDeploy(): void {
  unsubscribe?.();
  unsubscribe = null;
  loader = async () => idleController();
  loading = null;
  mirror.setState({ state: IDLE });
}
