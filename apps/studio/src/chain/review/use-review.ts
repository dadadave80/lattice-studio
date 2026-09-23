/**
 * What the review reads besides the stores: the lazy chain module (its account, connectors and the selected chain's
 * readiness) and S8c's deploy controller. Both load on first use; until they do the hooks return null and the
 * sections say what they're waiting for.
 */
import { isNotImplemented } from "@lattice-studio/core";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  chainService, deployController, type ChainReadiness, type ChainService, type DeployController, type WalletAccount,
  type WalletConnector,
} from "@/contracts";

export type Loaded<T> = { status: "loading" } | { status: "ready"; value: T } | { status: "error"; reason: string };

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function useLoaded<T>(load: () => Promise<T>): Loaded<T> {
  const [state, setState] = useState<Loaded<T>>({ status: "loading" });
  useEffect(() => {
    let live = true;
    load().then(
      (value) => {
        if (live) setState({ status: "ready", value });
      },
      (error: unknown) => {
        if (!isNotImplemented(error)) console.error(error);
        if (live) setState({ status: "error", reason: reasonOf(error) });
      },
    );
    return () => {
      live = false;
    };
  }, [load]);
  return state;
}

/** The chain module, loading it on first use ("Loading wallet support…", spec L562). */
export function useChainService(): Loaded<ChainService> {
  return useLoaded(chainService);
}

/** S8c's deploy controller, loading its chunk on first use. */
export function useController(): Loaded<DeployController> {
  return useLoaded(deployController);
}

const noop = () => () => {};

export function useAccount(service: ChainService | null): WalletAccount | null {
  return useSyncExternalStore(
    (onChange) => (service ? service.subscribeAccount(onChange) : noop()),
    () => (service ? service.account() : null),
  );
}

export function useConnectors(service: ChainService | null): readonly WalletConnector[] {
  return useSyncExternalStore(
    (onChange) => (service ? service.subscribeConnectors(onChange) : noop()),
    () => (service ? service.connectors() : EMPTY),
  );
}

const EMPTY: readonly WalletConnector[] = [];
const UNKNOWN: ChainReadiness = { status: "unknown" };
const CHECKING: ChainReadiness = { status: "checking" };

/** One object per state, so a service that builds a fresh `{ status: "unknown" }` per call never loops a render. */
function stable(next: ChainReadiness, last: ChainReadiness): ChainReadiness {
  if (next.status === "unknown") return UNKNOWN;
  if (next.status === "checking") return CHECKING;
  if (next.status === "error" && last.status === "error" && last.reason === next.reason) return last;
  if (next.status === "ready" && last.status === "ready" && last.state === next.state) return last;
  return next;
}

export function useReadiness(service: ChainService | null, chainId: number | null): ChainReadiness {
  const last = useRef<ChainReadiness>(UNKNOWN);
  return useSyncExternalStore(
    (onChange) => (service ? service.subscribeReadiness((id) => (id === chainId ? onChange() : undefined)) : noop()),
    () => {
      last.current = stable(service && chainId !== null ? service.readiness(chainId) : UNKNOWN, last.current);
      return last.current;
    },
  );
}
