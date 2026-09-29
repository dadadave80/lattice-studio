/**
 * The diamond's predicted address for the current path, account, salt and chain (spec L286, L365, L858),
 * or why there's none yet. S4d's title block and S8b's review show it with `usePrediction()`; the analysis
 * context uses it for "This diamond" (`refs.self`) and the deploy context.
 *
 * Every new prediction is recorded in `project.predicted` with C11's `recordPrediction` through `doc.record`
 * (no undo step), so AUTH-02 later recognizes an address this diamond had under another salt, account or
 * chain. Nothing else records predictions.
 */
import type { Address, Catalog, DeployPath, Hex, Project, Scope } from "@lattice-studio/core";
import { buildSalt, createxPredict, factoryPredict, recordPrediction, sameAddress, toChecksum } from "@lattice-studio/core";
import { doc, getCatalog, session, subscribeCatalog, type WalletAccount } from "@/contracts";
import type { ChainMirror } from "./chain-mirror";

export type Prediction =
  | {
      status: "ready";
      address: Address;
      chainId: number;
      path: DeployPath;
      scope: Scope;
      /** The deploying account the salt is built from. */
      from: Address;
      /** `from ‖ flag ‖ entropy`. */
      salt: Hex;
    }
  | { status: "none"; reason: string };

/** Spec L365: the title block's line while no wallet is connected. */
export const NEEDS_WALLET = "Connect a wallet to see the deploy address (it depends on the deploying account)";
export const NEEDS_CHAIN = "Choose a chain to see the deploy address";
export const NEEDS_CATALOG = "The catalog hasn't loaded yet · Wait for it to finish";

export type PredictionInput = {
  deploy: Project["deploy"];
  catalog: Catalog | null;
  chainId: number | null;
  account: Pick<WalletAccount, "address"> | null;
};

/** The prediction for these inputs (pure). */
export function predict(input: PredictionInput): Prediction {
  const { deploy, catalog, chainId, account } = input;
  if (!account) return { status: "none", reason: NEEDS_WALLET };
  if (chainId === null) return { status: "none", reason: NEEDS_CHAIN };
  if (!catalog) return { status: "none", reason: NEEDS_CATALOG };
  try {
    const from = toChecksum(account.address);
    const salt = buildSalt(from, deploy.scope, deploy.entropy);
    let address: Address;
    if (deploy.path === "createx") {
      address = createxPredict({ from, salt, chainId });
    } else {
      // A chain-specific factory when the catalog lists one, else the release factory (as C5c deploys).
      const own = catalog.chains.find((entry) => entry.chainId === chainId)?.factory;
      address = factoryPredict({
        factory: toChecksum(own?.address ?? catalog.factory.address),
        proxyInitCodeHash: own?.proxyInitCodeHash ?? catalog.proxy.initCodeHash,
        from,
        salt,
      });
    }
    return { status: "ready", address: toChecksum(address), chainId, path: deploy.path, scope: deploy.scope, from, salt };
  } catch (error) {
    return { status: "none", reason: error instanceof Error ? error.message : String(error) };
  }
}

function samePrediction(a: Prediction, b: Prediction): boolean {
  if (a.status !== b.status) return false;
  if (a.status === "none" || b.status === "none") return a.status === "none" && b.status === "none" && a.reason === b.reason;
  return a.address === b.address && a.chainId === b.chainId && a.path === b.path && a.scope === b.scope && a.salt === b.salt;
}

export type PredictionMirror = {
  /** The current prediction; the same object until it changes. */
  get(): Prediction;
  subscribe(listener: () => void): () => void;
  /** Starts following the document, catalog, session and chain; returns a disposer. Idempotent. */
  start(): () => void;
};

export function createPredictionMirror(chain: ChainMirror): PredictionMirror {
  let current: Prediction = { status: "none", reason: NEEDS_WALLET };
  let started = false;
  const listeners = new Set<() => void>();
  const stops: (() => void)[] = [];

  const compute = (): Prediction => {
    const next = predict({
      deploy: doc.get().deploy,
      catalog: getCatalog(),
      chainId: session.get().chainId,
      account: chain.account(),
    });
    if (samePrediction(current, next)) return current;
    current = next;
    for (const listener of Array.from(listeners)) listener();
    return current;
  };

  /** Records a ready prediction the project doesn't hold yet. Skipped while read-only (the other tab records). */
  const record = (): void => {
    const p = current;
    if (p.status !== "ready" || session.get().readOnly !== null) return;
    const known = doc.get().predicted.some((q) => q.chainId === p.chainId && sameAddress(q.address, p.address));
    if (known) return;
    doc.record("Recorded the predicted address", (project) => recordPrediction(project, { chainId: p.chainId, address: p.address }));
  };

  /**
   * Recording writes the document, so it waits for a microtask: never a store write from inside another
   * store's listener, where later listeners would then see the older state last.
   */
  let queued = false;
  const refresh = (): void => {
    compute();
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      if (started) record();
    });
  };

  return {
    get: () => (started ? current : compute()),
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
        doc.subscribe((state, previous) => {
          if (state.project.deploy !== previous.project.deploy || state.project.predicted !== previous.project.predicted
            || state.project.id !== previous.project.id) refresh();
        }),
        session.subscribe((state, previous) => {
          if (state.chainId !== previous.chainId || state.readOnly !== previous.readOnly) refresh();
        }),
        subscribeCatalog(() => refresh()),
        chain.subscribe(() => refresh()),
      );
      refresh();
      return () => {
        started = false;
        for (const stop of stops.splice(0)) stop();
      };
    },
  };
}
