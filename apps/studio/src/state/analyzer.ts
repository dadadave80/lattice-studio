/**
 * Core's `analyze` and `narrate`, loaded right after the first paint rather than in the entry (spec L822, Q19): the
 * checks they run are most of core. Nothing can be analyzed before the catalog arrives, and the catalog is a larger
 * fetch than this chunk, so the analysis is never later for it. `analysis-engine.ts` asks for it when it starts and
 * reads it once it's here; until then the analysis is empty, as it is while the catalog loads.
 */
import type { analyze, narrate } from "@lattice-studio/core";

export type Analyzer = { analyze: typeof analyze; narrate: typeof narrate };

let loaded: Analyzer | null = null;
let loading: Promise<Analyzer> | null = null;
const listeners = new Set<() => void>();

/** The analyzer, if it has loaded. */
export function loadedAnalyzer(): Analyzer | null {
  return loaded;
}

/** The analyzer, loading it the first time; listeners hear when it arrives. */
export function loadAnalyzer(): Promise<Analyzer> {
  if (loaded) return Promise.resolve(loaded);
  loading ??= import("./analyzer-impl").then(
    ({ ANALYZER }) => {
      loaded = ANALYZER;
      for (const listener of Array.from(listeners)) listener();
      return ANALYZER;
    },
    (error: unknown) => {
      // A chunk that failed to load can be asked for again (the PWA's chunk-error watcher offers a reload).
      loading = null;
      throw error;
    },
  );
  return loading;
}

/** Calls `listener` once the analyzer has loaded. Returns a disposer. */
export function onAnalyzerLoaded(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
