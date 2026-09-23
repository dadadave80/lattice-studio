/**
 * S1's state, assembled: the three stores, the chain, deployment and prediction mirrors, and the analysis
 * engine. `services.ts` installs one at module evaluation; tests install their own with `installStudioState`
 * and dispose it afterwards.
 */
import type { StoreApi } from "zustand/vanilla";
import { createStore } from "zustand/vanilla";
import { doc, provideAnalysis, provideStores, session, type SessionState, type SettingsState } from "@/contracts";
import { createAnalysisEngine, type AnalysisEngine, type AnalysisEngineDeps } from "./analysis-engine";
import { createChainMirror, type ChainMirror } from "./chain-mirror";
import { createDeploymentsMirror, type DeploymentsMirror } from "./deployments-mirror";
import { createDocumentStore, type DocumentStoreOptions, type HistoryDocumentStore } from "./document-store";
import { startPinning } from "./pinning";
import { createPredictionMirror, type PredictionMirror } from "./prediction";
import { createSettingsStore, type SettingsStorage } from "./settings-store";

export type StudioState = {
  document: HistoryDocumentStore;
  session: StoreApi<SessionState>;
  settings: StoreApi<SettingsState>;
  chain: ChainMirror;
  deployments: DeploymentsMirror;
  prediction: PredictionMirror;
  analysis: AnalysisEngine;
  /** Stops settings persistence. */
  stopSettings: () => void;
};

export type StudioStateOptions = {
  document?: DocumentStoreOptions;
  /** Default: the browser's localStorage; null keeps settings in memory. */
  storage?: SettingsStorage | null;
  analyze?: AnalysisEngineDeps["analyze"];
  narrate?: AnalysisEngineDeps["narrate"];
};

export function createStudioState(options: StudioStateOptions = {}): StudioState {
  const settings = options.storage === undefined ? createSettingsStore() : createSettingsStore(options.storage);
  const chain = createChainMirror();
  const deployments = createDeploymentsMirror();
  const prediction = createPredictionMirror(chain);
  const deps: AnalysisEngineDeps = { chain, deployments, prediction };
  if (options.analyze) deps.analyze = options.analyze;
  if (options.narrate) deps.narrate = options.narrate;
  return {
    // Whatever ran before S1's stores (K2's, a test's seed) carries over: the open project and the session.
    document: createDocumentStore({ initial: doc.get(), ...options.document }),
    session: createStore<SessionState>(() => ({ ...session.get() })),
    settings: settings.store,
    chain,
    deployments,
    prediction,
    analysis: createAnalysisEngine(deps),
    stopSettings: settings.stop,
  };
}

let active: StudioState | null = null;

/** The installed state. Throws before `services.ts` (or a test) installed one. */
export function studioState(): StudioState {
  if (!active) throw new Error("S1's state isn't installed: import state/services.ts or call installStudioState.");
  return active;
}

/**
 * Provides the state's stores and analysis to the contracts and starts narration. Returns a disposer that
 * stops it and puts back what was there before.
 */
export function installStudioState(state: StudioState): () => void {
  const previous = active;
  active = state;
  const disposeStores = provideStores({ document: state.document, session: state.session, settings: state.settings });
  const disposeAnalysis = provideAnalysis(state.analysis.provider);
  const stop = state.analysis.start();
  const stopPinning = startPinning(state.document);
  return () => {
    stopPinning();
    stop();
    state.stopSettings();
    disposeAnalysis();
    disposeStores();
    if (active === state) active = previous;
  };
}
