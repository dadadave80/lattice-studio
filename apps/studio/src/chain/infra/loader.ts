/**
 * The lazy boundary (spec L822, decision 13): the chain module (viem clients, wagmi, connectors) loads through
 * `import()` on the first call to `chainService()`, which happens on Deploy, on choosing a chain or on any
 * other on-chain read. While it loads, surfaces show "Loading wallet support…" (spec L562) from `useChainLoad()`.
 *
 * A chunk that fails to load isn't worded here: S11a's `vite:preloadError` banner already says "Studio was
 * updated. Save and reload to continue." The error goes to the browser console, and the next call tries again.
 *
 * Light: this file is in the entry chunk (through `services.ts`), so it never imports the module statically.
 */
import { useSyncExternalStore } from "react";
import type { ChainService } from "@/contracts";
import { LOADING_WALLET_SUPPORT } from "./copy";

export type ChainLoadState =
  | { status: "idle" }
  | { status: "loading"; text: string }
  | { status: "ready" }
  /** `reason` is for the console; nothing shows it. */
  | { status: "failed"; reason: string };

export type ChainLoader = {
  /** Loads the module once; a failed load is tried again on the next call. */
  load(): Promise<ChainService>;
  state(): ChainLoadState;
  subscribe(listener: () => void): () => void;
};

const IDLE: ChainLoadState = { status: "idle" };
const READY: ChainLoadState = { status: "ready" };
const LOADING: ChainLoadState = { status: "loading", text: LOADING_WALLET_SUPPORT };

/** A loader around `importer`, which resolves to the service (the real one imports `./runtime`). */
export function createChainLoader(importer: () => Promise<ChainService>): ChainLoader {
  let state: ChainLoadState = IDLE;
  let pending: Promise<ChainService> | null = null;
  const listeners = new Set<() => void>();
  const set = (next: ChainLoadState): void => {
    state = next;
    for (const listener of Array.from(listeners)) listener();
  };
  return {
    load() {
      if (pending) return pending;
      set(LOADING);
      pending = importer().then(
        (service) => {
          set(READY);
          return service;
        },
        (error: unknown) => {
          pending = null;
          console.error(error);
          set({ status: "failed", reason: error instanceof Error ? error.message : String(error) });
          throw error;
        },
      );
      return pending;
    },
    state: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The app's loader: the real module, created once. */
export const chainLoader: ChainLoader = createChainLoader(() => import("./runtime").then((m) => m.chainRuntime()));

/** The loader's state, re-rendering when it changes. `loader` defaults to the app's. */
export function useChainLoad(loader: ChainLoader = chainLoader): ChainLoadState {
  return useSyncExternalStore(loader.subscribe, loader.state);
}
