import {
  buildPassport, identifyFacets, isAddress, sameAddress, toChecksum,
  type Address, type Catalog, type Passport, type PassportIdentifiedFacet, type Result,
} from "@lattice-studio/core";
import type { ChainInfo } from "@/contracts";
import type { DiamondCutHistory } from "@/contracts/chain";
import type { DiamondSnapshot, SnapshotReadError } from "./snapshot";

export type InspectionTarget = { chainId: number; address: Address };
export type ReadyInspection = {
  target: InspectionTarget;
  chainName: string;
  explorer?: string;
  snapshot: DiamondSnapshot;
  facets: PassportIdentifiedFacet[];
  passport: Passport;
  primaryName: string | null;
  /** Changes with observed chain facts or the catalog/ABI identity, independently of local writes. */
  identity: string;
};
export type InspectionState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; reason: string }
  | { status: "ready" | "no-code" | "not-diamond"; value: ReadyInspection };

export type InspectionPorts = {
  chains: readonly ChainInfo[];
  read(target: InspectionTarget, signal: AbortSignal): Promise<Result<DiamondSnapshot, SnapshotReadError>>;
  catalogs(): Promise<Result<readonly Catalog[], string>>;
  reverseName?(target: InspectionTarget): Promise<Result<string | null, string>>;
};

type Entry = { state: InspectionState; controller: AbortController; running: Promise<void> | null };
const IDLE: InspectionState = { status: "idle" };
const keyOf = (target: InspectionTarget) => `${target.chainId}:${target.address.toLowerCase()}`;

/** Session cache of chain observations. It never reads or edits the current composition. */
export function createInspectionEngine(ports: InspectionPorts) {
  const entries = new Map<string, Entry>();
  const listeners = new Set<() => void>();
  let disposed = false;

  const notify = () => { for (const listener of listeners) listener(); };

  const load = (input: InspectionTarget, refresh: boolean): Promise<void> => {
    if (disposed) return Promise.resolve();
    const key = keyOf(input);
    const previous = entries.get(key);
    if (previous && !refresh) return previous.running ?? Promise.resolve();
    previous?.controller.abort();
    const entry: Entry = { state: { status: "loading" }, controller: new AbortController(), running: null };
    entries.set(key, entry);
    const current = () => !disposed && entries.get(key) === entry && !entry.controller.signal.aborted;
    const publish = (state: InspectionState) => {
      if (!current()) return;
      entry.state = state;
      notify();
    };
    const chain = ports.chains.find((item) => item.id === input.chainId && item.testnet);
    if (!chain) {
      publish({ status: "error", reason: `Studio doesn't support chain ${input.chainId} yet.` });
      return Promise.resolve();
    }
    if (!isAddress(input.address)) {
      publish({ status: "error", reason: "This isn't a diamond address." });
      return Promise.resolve();
    }
    const target = { chainId: input.chainId, address: toChecksum(input.address) };
    entry.running = (async () => {
      await Promise.resolve();
      if (!current()) return;
      let primaryName: string | null = null;
      if (ports.reverseName) {
        void Promise.resolve().then(() => ports.reverseName!(target)).then((name) => {
          if (!current() || !name.ok || name.value === null) return;
          primaryName = name.value;
          if ("value" in entry.state) publish({ ...entry.state, value: { ...entry.state.value, primaryName } });
        }).catch(() => undefined);
      }
      try {
        const [read, catalogs] = await Promise.all([ports.read(target, entry.controller.signal), ports.catalogs()]);
        if (!current()) return;
        if (!read.ok) { publish({ status: "error", reason: read.error.reason }); return; }
        if (!catalogs.ok) { publish({ status: "error", reason: catalogs.error }); return; }
        const catalog = catalogs.value[0];
        if (!catalog) { publish({ status: "error", reason: "No catalog is available to identify this diamond." }); return; }
        const snapshot = read.value;
        const facets = identifyFacets(snapshot.facets ?? [], snapshot.codehashes, catalogs.value, target.address);
        const passport = buildPassport({
          chainId: target.chainId, chainName: chain.name, address: target.address,
          block: snapshot.block, hasCode: snapshot.code !== "0x", loupe: snapshot.facets,
          codehashes: snapshot.codehashes, history: null, historySource: null, deployment: null,
          ownerRouted: snapshot.ownerRouted, owner: snapshot.owner,
        }, facets, null, { tag: catalog.lattice.tag, hash: catalog.hash });
        const value: ReadyInspection = {
          target, chainName: chain.name, snapshot, facets, passport, primaryName,
          ...(chain.explorer ? { explorer: `${chain.explorer.replace(/\/$/, "")}/address/${target.address}` } : {}),
          identity: [snapshot.blockHash, passport.digest, ...catalogs.value.map((item) => item.hash)].join(":"),
        };
        publish({ status: snapshot.code === "0x" ? "no-code" : snapshot.facets === null ? "not-diamond" : "ready", value });
      } catch {
        publish({ status: "error", reason: `Couldn't inspect the diamond on ${chain.name}. Retry the inspection.` });
      } finally {
        entry.running = null;
      }
    })();
    notify();
    return entry.running;
  };

  return {
    get(target: InspectionTarget): InspectionState { return entries.get(keyOf(target))?.state ?? IDLE; },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    ensure(target: InspectionTarget): Promise<void> { return load(target, false); },
    refresh(target: InspectionTarget): Promise<void> { return load(target, true); },
    /** History changes claims, never the observed facts/ABI identity used by call and transaction reviews. */
    attachHistory(target: InspectionTarget, history: DiamondCutHistory, identity: string): boolean {
      const entry = entries.get(keyOf(target));
      if (disposed || entry?.state.status !== "ready" || history.coverage !== "full" || history.fromBlock !== 0 || history.deployment === null) return false;
      const value = entry.state.value;
      const first = [...history.history].sort((a, b) => a.block - b.block || a.logIndex - b.logIndex)[0];
      if (history.chainId !== value.target.chainId || !sameAddress(history.address, value.target.address)
        || value.identity !== identity || value.snapshot.block !== history.toBlock || value.snapshot.blockHash.toLowerCase() !== history.blockHash.toLowerCase()
        || first === undefined || first.txHash.toLowerCase() !== history.deployment.txHash.toLowerCase() || first.block !== history.deployment.block) return false;
      const snapshot = value.snapshot;
      const passport = buildPassport({
        chainId: value.target.chainId, chainName: value.chainName, address: value.target.address, block: snapshot.block,
        hasCode: snapshot.code !== "0x", loupe: snapshot.facets, codehashes: snapshot.codehashes,
        history: history.history, historySource: history.source, deployment: history.deployment,
        ownerRouted: snapshot.ownerRouted, owner: snapshot.owner,
      }, value.facets, null, value.passport.catalog);
      entry.state = { ...entry.state, value: { ...value, passport } };
      notify();
      return true;
    },
    invalidate(target?: InspectionTarget): void {
      if (disposed) return;
      if (target) {
        const key = keyOf(target);
        entries.get(key)?.controller.abort();
        entries.delete(key);
      } else {
        for (const entry of entries.values()) entry.controller.abort();
        entries.clear();
      }
      notify();
    },
    dispose(): void {
      disposed = true;
      for (const entry of entries.values()) entry.controller.abort();
      entries.clear();
      listeners.clear();
    },
  };
}

export type InspectionEngine = ReturnType<typeof createInspectionEngine>;
