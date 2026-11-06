import { isNotImplemented, type Analysis, type AnalyzeFn, type Catalog, type Recipe } from "@lattice-studio/core";

type Dependencies = {
  empty: Analysis;
  recipe(): Recipe;
  catalog(): Catalog | null;
  subscribeRecipe(listener: () => void): () => void;
  subscribeCatalog(listener: () => void): () => void;
  load(): Promise<AnalyzeFn>;
};

/** The fallback never makes core's checks part of first load; S1 supplies its own complete provider. */
export function createFallbackAnalysisProvider(deps: Dependencies) {
  let analyze: AnalyzeFn | null = null;
  let loading: Promise<void> | null = null;
  let cache: { recipe: Recipe; catalog: Catalog; analysis: Analysis } | null = null;
  const listeners = new Set<() => void>();
  return {
    getAnalysis(): Analysis {
      const recipe = deps.recipe();
      const catalog = deps.catalog();
      if (!catalog) return deps.empty;
      if (!analyze) {
        loading ??= Promise.resolve().then(deps.load).then((loaded) => {
          analyze = loaded;
          loading = null;
          for (const listener of Array.from(listeners)) listener();
        }, () => {
          // No state change: avoid a render/import retry loop. A later read can retry the chunk.
          loading = null;
        });
        return deps.empty;
      }
      if (cache && cache.recipe === recipe && cache.catalog === catalog) return cache.analysis;
      let analysis = deps.empty;
      try { analysis = analyze(recipe, catalog); }
      catch (error) { if (!isNotImplemented(error)) throw error; }
      cache = { recipe, catalog, analysis };
      return analysis;
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      const stopRecipe = deps.subscribeRecipe(listener);
      const stopCatalog = deps.subscribeCatalog(listener);
      return () => { listeners.delete(listener); stopRecipe(); stopCatalog(); };
    },
  };
}
