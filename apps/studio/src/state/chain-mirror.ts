/**
 * What the analysis context and the prediction need from the lazy chain module (contracts §5.2 "chain"):
 * the connected account, the selected chain's readiness and chain names, read synchronously.
 *
 * The chain module loads only once a chain is selected (spec L102 decision 13: the wallet stack loads on
 * demand), so an app that never picks a chain never fetches it. Until S8a registers, `chainService()` rejects
 * with NotImplemented and the mirror stays empty: no account, no readiness, nothing to predict.
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
  let loading = false;
  let account: WalletAccount | null = null;
  let chains: readonly ChainInfo[] = [];
  const readiness = new Map<number, ChainReadiness>();
  const listeners = new Set<() => void>();
  const stops: (() => void)[] = [];
  let started = false;

  const emit = (): void => {
    for (const listener of Array.from(listeners)) listener();
  };

  const attach = (loaded: ChainService): void => {
    service = loaded;
    account = loaded.account();
    chains = loaded.chains();
    stops.push(
      loaded.subscribeAccount((next) => {
        account = next;
        emit();
      }),
      loaded.subscribeReadiness((chainId) => {
        readiness.set(chainId, loaded.readiness(chainId));
        emit();
      }),
    );
    const chainId = session.get().chainId;
    if (chainId !== null) readiness.set(chainId, loaded.readiness(chainId));
    emit();
  };

  const ensure = (chainId: number | null): void => {
    if (chainId === null) return;
    if (service) {
      const next = service.readiness(chainId);
      if (readiness.get(chainId) !== next) {
        readiness.set(chainId, next);
        emit();
      }
      return;
    }
    if (loading) return;
    loading = true;
    load().then(
      (loaded) => {
        if (started) attach(loaded);
      },
      () => {
        // Not built yet (S8a) or the chunk failed to load: nothing to mirror. chain.select says why.
        loading = false;
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
      stops.push(
        session.subscribe((state, previous) => {
          if (state.chainId !== previous.chainId) {
            ensure(state.chainId);
            emit();
          }
        }),
      );
      ensure(session.get().chainId);
      return () => {
        started = false;
        for (const stop of stops.splice(0)) stop();
        service = null;
        loading = false;
      };
    },
  };
}
