/**
 * The analysis of the open document (contracts §5.1 `useAnalysis`). S1 provides the real one (memoized on
 * the recipe hash, catalog hash and context digest, with narration). K2's default runs core's `analyze`
 * without a context and degrades to an empty analysis while `analyze` is still a stub or no catalog is loaded.
 *
 * The analysis is an external store: `getAnalysis()` must return the same object until it changes, and
 * `subscribe` calls back when it does. `useAnalysis(selector, equal)` re-renders only when the selected
 * value changes, so a memoized card can read just its own routing and problems (spec L825).
 */
import type { Analysis, Catalog, Recipe } from "@lattice-studio/core";
import { analyze, isNotImplemented } from "@lattice-studio/core";
import { useStoreWithEqualityFn } from "zustand/traditional";
import type { StoreApi } from "zustand/vanilla";
import { getCatalog, subscribeCatalog } from "./catalog";
import { doc } from "./stores";

export type AnalysisProvider = {
  /** The current analysis; the same object until it changes. */
  getAnalysis(): Analysis;
  /** Calls back after the analysis changes. */
  subscribe(listener: () => void): () => void;
};

/** An analysis with nothing in it: no routing, no problems, no plan. */
export function emptyAnalysis(): Analysis {
  return {
    recipeHash: "0x",
    routing: {},
    problems: [],
    plan: [],
    init: null,
    stats: { facets: 0, routed: 0, exported: 0, excluded: 0, namespaces: 0 },
  };
}

const EMPTY = emptyAnalysis();

function minimalProvider(): AnalysisProvider {
  let cache: { recipe: Recipe; catalog: Catalog; analysis: Analysis } | null = null;
  const compute = (): Analysis => {
    const recipe = doc.get().recipe;
    const catalog = getCatalog();
    if (!catalog) return EMPTY;
    if (cache && cache.recipe === recipe && cache.catalog === catalog) return cache.analysis;
    let analysis = EMPTY;
    try {
      analysis = analyze(recipe, catalog);
    } catch (error) {
      if (!isNotImplemented(error)) throw error;
    }
    cache = { recipe, catalog, analysis };
    return analysis;
  };
  return {
    getAnalysis: compute,
    subscribe(listener) {
      const stopDoc = doc.subscribe((state, previous) => {
        if (state.project.recipe !== previous.project.recipe) listener();
      });
      const stopCatalog = subscribeCatalog(() => listener());
      return () => {
        stopDoc();
        stopCatalog();
      };
    },
  };
}

let provider: AnalysisProvider = minimalProvider();
const listeners = new Set<(state: Analysis, previous: Analysis) => void>();
let last: Analysis = EMPTY;
let detach: (() => void) | null = null;

function fanout(): void {
  const previous = last;
  last = provider.getAnalysis();
  if (last === previous) return;
  for (const listener of Array.from(listeners)) listener(last, previous);
}

/** (Re)subscribes to the current provider while anyone listens; `notify` tells listeners if the value moved. */
function attach(notify = false): void {
  detach?.();
  detach = null;
  if (listeners.size === 0) return;
  const before = last;
  last = provider.getAnalysis();
  detach = provider.subscribe(fanout);
  if (notify && last !== before) for (const listener of Array.from(listeners)) listener(last, before);
}

/** A stable read-only store over whichever provider is current. */
const analysisStore: StoreApi<Analysis> = {
  getState: () => provider.getAnalysis(),
  getInitialState: () => provider.getAnalysis(),
  setState: () => {
    throw new Error("The analysis is derived; it can't be set.");
  },
  subscribe(listener) {
    listeners.add(listener);
    if (listeners.size === 1) attach();
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) attach();
    };
  },
};

/** S1 registers its provider at module evaluation. Mounted readers follow it. Returns a disposer. */
export function provideAnalysis(provided: AnalysisProvider): () => void {
  const previous = provider;
  provider = provided;
  attach(true);
  return () => {
    if (provider !== provided) return;
    provider = previous;
    attach(true);
  };
}

const identity = (analysis: Analysis): Analysis => analysis;

/**
 * The analysis, or the part `selector` picks. Re-renders only when the selection changes by `equal`
 * (default `Object.is`; pass a shallow or structural equality for derived objects).
 */
export function useAnalysis(): Analysis;
export function useAnalysis<T>(selector: (analysis: Analysis) => T, equal?: (a: T, b: T) => boolean): T;
export function useAnalysis<T>(selector?: (analysis: Analysis) => T, equal?: (a: T, b: T) => boolean): T | Analysis {
  const pick = (selector ?? identity) as (analysis: Analysis) => T | Analysis;
  return useStoreWithEqualityFn(analysisStore, pick, equal as ((a: T | Analysis, b: T | Analysis) => boolean) | undefined);
}

/** The analysis now, for commands and services. Never call it in render. */
export function getAnalysis(): Analysis {
  return provider.getAnalysis();
}

/** Subscribes to analysis changes outside React. */
export function subscribeAnalysis(listener: (analysis: Analysis, previous: Analysis) => void): () => void {
  return analysisStore.subscribe(listener);
}

/** @internal Contract tests: K2's provider. Returns a disposer that restores the previous one. */
export function resetAnalysis(): () => void {
  const previous = provider;
  provider = minimalProvider();
  attach();
  return () => {
    provider = previous;
    attach();
  };
}
