/**
 * The analysis of the open document (contracts §5.1 `useAnalysis`). S1 provides the real one (memoized on
 * the recipe hash, catalog hash and context digest, with narration). K2's default runs core's `analyze`
 * without a context and degrades to an empty analysis while `analyze` is still a stub or no catalog is loaded.
 */
import type { Analysis, Catalog, Recipe } from "@lattice-studio/core";
import { analyze, isNotImplemented } from "@lattice-studio/core";
import { useMemo } from "react";
import { getCatalog, useCatalog } from "./catalog";
import { doc, useDocument } from "./stores";

export type AnalysisProvider = {
  /** A hook. */
  useAnalysis(): Analysis;
  /** Non-reactive, for commands and services. */
  getAnalysis(): Analysis;
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
let cache: { recipe: Recipe; catalog: Catalog; analysis: Analysis } | null = null;

function compute(recipe: Recipe, catalog: Catalog | null): Analysis {
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
}

function minimalProvider(): AnalysisProvider {
  return {
    useAnalysis() {
      const recipe = useDocument((s) => s.project.recipe);
      const catalog = useCatalog();
      return useMemo(() => compute(recipe, catalog), [recipe, catalog]);
    },
    getAnalysis: () => compute(doc.get().recipe, getCatalog()),
  };
}

let provider: AnalysisProvider = minimalProvider();

/** S1 registers its provider at module evaluation. Returns a disposer that restores the previous one. */
export function provideAnalysis(provided: AnalysisProvider): () => void {
  const previous = provider;
  provider = provided;
  return () => {
    if (provider === provided) provider = previous;
  };
}

export function useAnalysis(): Analysis {
  return provider.useAnalysis();
}

export function getAnalysis(): Analysis {
  return provider.getAnalysis();
}

/** @internal The harness's reset between tests. */
export function resetAnalysis(): void {
  provider = minimalProvider();
  cache = null;
}
