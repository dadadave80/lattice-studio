/**
 * The lazy chain module (contracts §5.2 "chain"), for views that read the chain: readiness rows, the
 * Deployments list's record checks, availability per chain, the Comparison view. The module loads only when a
 * view asks (`wanted`), so the inspector never pulls in the wallet stack for a project that never picks a chain
 * (spec L28, decision 13).
 */
import type { ChainInfo, ChainReadiness, ChainService } from "@/contracts";
import { chainService } from "@/contracts";
import { isNotImplemented } from "@lattice-studio/core";
import { useEffect, useState, useSyncExternalStore } from "react";

export type ChainAccess =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; service: ChainService }
  /** `reason`: "Not built yet · WP-S8a", or why the chunk didn't load. */
  | { status: "unavailable"; reason: string };

const IDLE: ChainAccess = { status: "idle" };
const LOADING: ChainAccess = { status: "loading" };

/** The chain service once `wanted` turns true; it stays loaded after that. */
export function useChainService(wanted: boolean): ChainAccess {
  const [access, setAccess] = useState<ChainAccess | null>(null);
  const settled = access !== null;
  useEffect(() => {
    if (!wanted || settled) return undefined;
    let live = true;
    chainService().then(
      (service) => {
        if (live) setAccess({ status: "ready", service });
      },
      (error: unknown) => {
        if (!live) return;
        const reason = isNotImplemented(error) || error instanceof Error ? error.message : String(error);
        setAccess({ status: "unavailable", reason });
      },
    );
    return () => {
      live = false;
    };
  }, [wanted, settled]);
  return access ?? (wanted ? LOADING : IDLE);
}

/** "Sepolia" for a chain id, from the chain module's list; "Chain 11155111" when it doesn't know it. */
export function chainNameOf(chains: readonly ChainInfo[] | null | undefined, chainId: number): string {
  return chains?.find((chain) => chain.id === chainId)?.name ?? `Chain ${chainId}`;
}

/** The chains the module knows, in display order; empty until it loads. */
export function useChains(access: ChainAccess): readonly ChainInfo[] {
  return access.status === "ready" ? access.service.chains() : NO_CHAINS;
}

const NO_CHAINS: readonly ChainInfo[] = Object.freeze([]);
const UNKNOWN: ChainReadiness = { status: "unknown" };

function sameReadiness(a: ChainReadiness, b: ChainReadiness): boolean {
  if (a.status !== b.status) return false;
  if (a.status === "ready" && b.status === "ready") return a.state === b.state;
  if (a.status === "error" && b.status === "error") return a.reason === b.reason;
  return true;
}

/** The last readiness handed out per service and chain, so an equal value keeps its identity. */
const handedOut = new WeakMap<ChainService, Map<number, ChainReadiness>>();

function stableReadiness(service: ChainService, chainId: number): ChainReadiness {
  let byChain = handedOut.get(service);
  if (!byChain) {
    byChain = new Map();
    handedOut.set(service, byChain);
  }
  const next = service.readiness(chainId);
  const last = byChain.get(chainId);
  if (last && sameReadiness(last, next)) return last;
  byChain.set(chainId, next);
  return next;
}

/** A chain's readiness as the chain module last knew it, re-rendering when it changes. */
export function useReadiness(access: ChainAccess, chainId: number | null): ChainReadiness {
  const service = access.status === "ready" ? access.service : null;
  const read = (): ChainReadiness => (service && chainId !== null ? stableReadiness(service, chainId) : UNKNOWN);
  return useSyncExternalStore((onChange) => {
    if (!service) return () => {};
    return service.subscribeReadiness((changed) => {
      if (changed === chainId) onChange();
    });
  }, read);
}
