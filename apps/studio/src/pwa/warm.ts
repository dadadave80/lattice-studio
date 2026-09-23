/**
 * Warms the catalog shard cache (spec L830): when a project opens or a facet is placed, the detail shard of
 * each facet on the sheet is requested once through the service worker, whose cache-first runtime cache keeps
 * it. The facets on a sheet then keep their ABIs, NatSpec and layouts offline.
 */
import type { Result } from "@lattice-studio/core";

export type WarmDeps = {
  /** The facets on the sheet now. */
  facets(): readonly string[];
  /** Calls back on every document change. */
  subscribeDocument(listener: () => void): () => void;
  /** The loaded catalog's id, or null while none is ready. */
  catalogId(): string | null;
  subscribeCatalog(listener: () => void): () => void;
  /** Loads a detail shard (`loadFacetDetail`). */
  load(name: string): Promise<Result<unknown, string>>;
  /** Whether a service worker controls the page; without one there's no cache to warm. */
  controlled(): boolean;
  /** Calls back when a service worker starts controlling the page. */
  subscribeControl?(listener: () => void): () => void;
  /** A load failed: maybe the network is gone. */
  reportFailure?(): void;
};

/**
 * Starts warming; returns a disposer. Each facet is requested once per catalog; one that failed is tried
 * again the next time the set of facets changes.
 */
export function warmShards(deps: WarmDeps): () => void {
  const requested = new Set<string>();
  /** The catalog and facet set last warmed, so drags and other edits that keep the set cost nothing. */
  let lastSet = "";
  const warm = () => {
    const id = deps.catalogId();
    if (id === null || !deps.controlled()) return;
    const facets = deps.facets();
    const set = `${id}:${facets.join(",")}`;
    if (set === lastSet) return;
    lastSet = set;
    for (const facet of facets) {
      const key = `${id}/${facet}`;
      if (requested.has(key)) continue;
      requested.add(key);
      void deps.load(facet).then(
        (result) => {
          if (result.ok) return;
          requested.delete(key);
          deps.reportFailure?.();
        },
        () => {
          requested.delete(key);
          deps.reportFailure?.();
        },
      );
    }
  };
  const stopDocument = deps.subscribeDocument(warm);
  const stopCatalog = deps.subscribeCatalog(warm);
  const stopControl = deps.subscribeControl?.(warm);
  warm();
  return () => {
    stopDocument();
    stopCatalog();
    stopControl?.();
  };
}
