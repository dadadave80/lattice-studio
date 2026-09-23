/**
 * Reads a diamond's `facets()` for the Comparison view: idle until there's a chain service to ask (it loaded
 * and the browser is online), then loading, ready or error. `retry()` reads again.
 */
import type { Address, LoupeFacet } from "@lattice-studio/core";
import { useCallback, useEffect, useState } from "react";
import type { ChainService } from "@/contracts";

export type LoupeRead =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; facets: readonly LoupeFacet[] }
  /** `error`: the chain module's sentence ("Sepolia's public RPC isn't answering."). */
  | { status: "error"; error: string };

export type Loupe = { read: LoupeRead; retry(): void };

const IDLE: LoupeRead = { status: "idle" };
const LOADING: LoupeRead = { status: "loading" };

/** `service`: null while there's nothing to ask (offline, or the chain module isn't loaded). */
export function useLoupe(service: ChainService | null, chainId: number, address: Address): Loupe {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; read: LoupeRead } | null>(null);
  const key = `${chainId}:${address.toLowerCase()}:${attempt}`;

  useEffect(() => {
    if (!service) return undefined;
    let live = true;
    const settle = (read: LoupeRead) => {
      if (live) setResult({ key, read });
    };
    service.readFacets(chainId, address).then(
      (outcome) => settle(outcome.ok ? { status: "ready", facets: outcome.value } : { status: "error", error: outcome.error }),
      (error: unknown) => settle({ status: "error", error: error instanceof Error ? error.message : String(error) }),
    );
    return () => {
      live = false;
    };
  }, [service, chainId, address, key]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const read = !service ? IDLE : result?.key === key ? result.read : LOADING;
  return { read, retry };
}
