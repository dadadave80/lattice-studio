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
import { useRef, useSyncExternalStore } from "react";
import { getCatalog, subscribeCatalog } from "./catalog";
import { listenerSet } from "./relay";
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
let last: Analysis = EMPTY;
let detach: (() => void) | null = null;

function fanout(): void {
  const previous = last;
  last = provider.getAnalysis();
  if (last === previous) return;
  listeners.emit(last, previous);
}

/** Subscribes upstream while anyone listens, and lets go when nobody does. */
function sync(): void {
  if (listeners.size > 0 && !detach) {
    last = provider.getAnalysis();
    detach = provider.subscribe(fanout);
  } else if (listeners.size === 0 && detach) {
    detach();
    detach = null;
  }
}

const listeners = listenerSet<(state: Analysis, previous: Analysis) => void>(sync);

/** Moves the upstream subscription to the current provider and tells listeners if the value moved. */
function repoint(): void {
  detach?.();
  detach = null;
  const before = last;
  sync();
  if (listeners.size > 0 && last !== before) listeners.emit(last, before);
}

/** S1 registers its provider at module evaluation. Mounted readers follow it. Returns a disposer. */
export function provideAnalysis(provided: AnalysisProvider): () => void {
  const previous = provider;
  provider = provided;
  repoint();
  return () => {
    if (provider !== provided) return;
    provider = previous;
    repoint();
  };
}

const identity = (analysis: Analysis): Analysis => analysis;

type Memo = { source: Analysis; pick: (analysis: Analysis) => unknown; value: unknown };

/**
 * The analysis, or the part `selector` picks. Re-renders only when the selection changes by `equal`
 * (default `Object.is`; pass a shallow or structural equality for derived objects). Built on React's own
 * `useSyncExternalStore`: the last selection is kept and returned while `equal` says nothing changed.
 */
export function useAnalysis(): Analysis;
export function useAnalysis<T>(selector: (analysis: Analysis) => T, equal?: (a: T, b: T) => boolean): T;
export function useAnalysis<T>(selector?: (analysis: Analysis) => T, equal?: (a: T, b: T) => boolean): T | Analysis {
  const pick = (selector ?? identity) as (analysis: Analysis) => T | Analysis;
  const same = (equal ?? Object.is) as (a: T | Analysis, b: T | Analysis) => boolean;
  const memo = useRef<Memo | null>(null);
  const getSnapshot = (): T | Analysis => {
    const source = provider.getAnalysis();
    const previous = memo.current;
    if (previous && previous.source === source && previous.pick === pick) return previous.value as T | Analysis;
    const next = pick(source);
    if (previous && same(previous.value as T | Analysis, next)) {
      memo.current = { source, pick, value: previous.value };
      return previous.value as T | Analysis;
    }
    memo.current = { source, pick, value: next };
    return next;
  };
  return useSyncExternalStore(subscribeAnalysis, getSnapshot);
}

/** The analysis now, for commands and services. Never call it in render. */
export function getAnalysis(): Analysis {
  return provider.getAnalysis();
}

/** Subscribes to analysis changes outside React. */
export function subscribeAnalysis(listener: (analysis: Analysis, previous: Analysis) => void): () => void {
  return listeners.add(listener);
}

/** @internal Contract tests: K2's provider. Returns a disposer that restores the previous one. */
export function resetAnalysis(): () => void {
  const previous = provider;
  provider = minimalProvider();
  repoint();
  return () => {
    provider = previous;
    repoint();
  };
}
