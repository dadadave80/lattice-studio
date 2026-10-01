/**
 * What Etherscan said about each diamond, kept in this browser beside the settings and outside the deployment
 * record: a record is exported with its project file, and Etherscan's outcome depends on a key that never is.
 * Keyed like the records store, by chain id and address. No entry means no outcome yet.
 *
 * Light: the Deployments list reads it, so nothing here imports the Etherscan client or the verify engine.
 */
import type { Deployment } from "@lattice-studio/core";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { env } from "@/contracts";

/** `keyed`: the API key or its plan caused the failure, so it's dropped when the key changes. */
export type EtherscanOutcome = { outcome: "verified" } | { outcome: "failed"; reason: string; keyed: boolean };

type Target = Pick<Deployment, "chainId" | "address">;
type Outcomes = Record<string, EtherscanOutcome>;

export const ETHERSCAN_OUTCOMES_KEY = "lattice-studio.etherscan.v1";

function keyOf(target: Target): string {
  return `${target.chainId}:${target.address.toLowerCase()}`;
}

/** Vitest keeps these in memory, like the other browser-storage services (`env.test`). */
function storage(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return env.test || typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** The stored outcomes that pass their checks; anything else is dropped, entry by entry. */
export function readOutcomes(raw: string | null): Outcomes {
  const out: Outcomes = {};
  if (raw === null) return out;
  let stored: unknown;
  try {
    stored = JSON.parse(raw);
  } catch {
    return out;
  }
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return out;
  for (const [key, value] of Object.entries(stored)) {
    if (!/^\d+:0x[0-9a-f]{40}$/.test(key) || typeof value !== "object" || value === null) continue;
    const entry = value as { outcome?: unknown; reason?: unknown; keyed?: unknown };
    if (entry.outcome === "verified") out[key] = { outcome: "verified" };
    else if (entry.outcome === "failed" && typeof entry.reason === "string") {
      out[key] = { outcome: "failed", reason: entry.reason, keyed: entry.keyed === true };
    }
  }
  return out;
}

function initial(): Outcomes {
  try {
    return readOutcomes(storage()?.getItem(ETHERSCAN_OUTCOMES_KEY) ?? null);
  } catch {
    return {};
  }
}

const store = createStore<Outcomes>(initial);

store.subscribe((state) => {
  try {
    storage()?.setItem(ETHERSCAN_OUTCOMES_KEY, JSON.stringify(state));
  } catch {
    // Storage full or blocked: the outcomes still hold for this session.
  }
});

export const etherscanOutcomes = {
  get(target: Target): EtherscanOutcome | undefined {
    return store.getState()[keyOf(target)];
  },
  set(target: Target, outcome: EtherscanOutcome): void {
    store.setState({ ...store.getState(), [keyOf(target)]: outcome }, true);
  },
  /** Forgets one diamond's outcome, so the next job tries it again. */
  clear(target: Target): void {
    const { [keyOf(target)]: _dropped, ...rest } = store.getState();
    store.setState(rest, true);
  },
  /** Forgets every failure the key caused: a new key is worth another try. */
  clearKeyed(): void {
    const kept = Object.entries(store.getState()).filter(([, o]) => !(o.outcome === "failed" && o.keyed));
    store.setState(Object.fromEntries(kept), true);
  },
  /** @internal Tests: back to empty. */
  reset(): void {
    store.setState({}, true);
  },
};

/** One diamond's outcome, for render. */
export function useEtherscanOutcome(target: Target): EtherscanOutcome | undefined {
  const key = keyOf(target);
  return useStore(store, (state) => state[key]);
}
