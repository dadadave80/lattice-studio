/**
 * What the analysis context and the prediction need from the lazy chain module (contracts §5.2 "chain"):
 * the connected account, the selected chain's readiness and chain names, read synchronously.
 *
 * The chain module loads only once a chain is selected (spec L28 decision 13: the wallet stack loads on
 * demand), so an app that never picks a chain never fetches it. Until S8a registers, `chainService()` rejects
 * with NotImplemented and the mirror stays empty: no account, no readiness, nothing to predict. Each new chain
 * selection asks for the service again, so a replaced implementation (S8a registering late, a test's fake) is
 * followed rather than held.
 */
import type { ChainState } from "@lattice-studio/core";
import { chainService, session, type ChainInfo, type ChainReadiness, type ChainService, type WalletAccount } from "@/contracts";

export type ChainMirror = {
  /** The connected account, or null (also while the chain module hasn't loaded). */
  account(): WalletAccount | null;
  /** The selected chain's probes, when its readiness is `ready`. */
  chainState(chainId: number): ChainState | undefined;
  /** "Sepolia", when the chain module knows the chain. */
  chainName(chainId: number): string | undefined;
  /** Calls back after the account, a readiness or the chain list changes. */
  subscribe(listener: () => void): () => void;
  /** Starts watching the session's chain; returns a disposer. Idempotent. */
  start(): () => void;
};

export function createChainMirror(load: () => Promise<ChainService> = chainService): ChainMirror {
  let service: ChainService | null = null;
  let account: WalletAccount | null = null;
  let chains: readonly ChainInfo[] = [];
  const readiness = new Map<number, ChainReadiness>();
  const listeners = new Set<() => void>();
  /** Subscriptions on the attached service. */
  let serviceStops: (() => void)[] = [];
  /** Bumped per request, so only the latest `load()` attaches. */
  let request = 0;
  let started = false;
  let stopSession: (() => void) | null = null;

  const emit = (): void => {
    for (const listener of Array.from(listeners)) listener();
  };

  const detach = (): void => {
    for (const stop of serviceStops.splice(0)) stop();
    service = null;
    account = null;
    chains = [];
    readiness.clear();
  };

  const attach = (loaded: ChainService): void => {
    detach();
    service = loaded;
    account = loaded.account();
    chains = loaded.chains();
    serviceStops = [
      loaded.subscribeAccount((next) => {
        account = next;
        emit();
      }),
      loaded.subscribeReadiness((chainId) => {
        readiness.set(chainId, loaded.readiness(chainId));
        emit();
      }),
    ];
    const chainId = session.get().chainId;
    if (chainId !== null) readiness.set(chainId, loaded.readiness(chainId));
  };

  const follow = (chainId: number | null): void => {
    if (chainId === null) return;
    request += 1;
    const mine = request;
    load().then(
      (loaded) => {
        if (!started || mine !== request) return;
        if (loaded !== service) attach(loaded);
        else readiness.set(chainId, loaded.readiness(chainId));
        emit();
      },
      () => {
        // Not built yet (S8a) or the chunk failed to load: nothing to mirror. chain.select says why.
        if (!started || mine !== request || service === null) return;
        detach();
        emit();
      },
    );
  };

  return {
    account: () => account,
    chainState(chainId) {
      const found = readiness.get(chainId);
      return found?.status === "ready" ? found.state : undefined;
    },
    chainName: (chainId) => chains.find((c) => c.id === chainId)?.name,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start() {
      if (started) return () => {};
      started = true;
      stopSession = session.subscribe((state, previous) => {
        if (state.chainId === previous.chainId) return;
        emit();
        follow(state.chainId);
      });
      follow(session.get().chainId);
      return () => {
        started = false;
        stopSession?.();
        stopSession = null;
        detach();
      };
    },
  };
}
