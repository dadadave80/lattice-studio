/**
 * The loaded catalog (contracts §4, §5.1 hooks). `main.tsx` fetches the manifest and hands it to
 * `startCatalog`; the catalog loader (K2's minimal one, then S14's) loads an index and publishes it with
 * `setCatalogStatus`. Detail shards load on demand through `useFacetDetail`.
 */
import type { Catalog, CatalogManifest, FacetDetail, Result } from "@lattice-studio/core";
import { validateCatalog } from "@lattice-studio/core";
import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";

export type CatalogStatus =
  | { status: "loading" }
  | { status: "ready"; id: string; catalog: Catalog; manifest: CatalogManifest | null }
  /** `reason` completes "Couldn't load the catalog. {reason}" (spec L695). */
  | { status: "error"; reason: string };

export type FacetDetailState =
  | { status: "loading" }
  | { status: "ready"; detail: FacetDetail }
  | { status: "error"; reason: string };

export type CatalogLoader = {
  /** Called once by `main.tsx` with the manifest fetch's result. */
  start(manifest: Result<CatalogManifest, string>): void;
  /** A hook: the facet's detail shard, loading it on first use. */
  useFacetDetail(name: string): FacetDetailState;
};

const store = createStore<{ status: CatalogStatus }>(() => ({ status: { status: "loading" } }));

/** Where catalogs are served: `/catalog/` under the app's base. */
export function catalogBase(): string {
  const base = import.meta.env.BASE_URL ?? "/";
  return `${base.endsWith("/") ? base : `${base}/`}catalog/`;
}

function indexUrl(entry: CatalogManifest["catalogs"][number]): string {
  const path = entry.path.replace(/^\.?\//, "");
  return `${catalogBase()}${path.endsWith(".json") ? path : `${path.replace(/\/$/, "")}/index.json`}`;
}

function minimalLoader(): CatalogLoader {
  return {
    start(manifest) {
      if (!manifest.ok) {
        setCatalogStatus({ status: "error", reason: manifest.error });
        return;
      }
      const entry = manifest.value.catalogs.find((c) => c.id === manifest.value.default);
      if (!entry) {
        setCatalogStatus({ status: "error", reason: `The manifest's default catalog "${manifest.value.default}" isn't listed.` });
        return;
      }
      fetch(indexUrl(entry))
        .then(async (response) => {
          if (!response.ok) throw new Error(`${entry.id}/index.json answered ${response.status}.`);
          const parsed = validateCatalog(await response.json());
          if (!parsed.ok) throw new Error(`${entry.id}/index.json doesn't match the catalog schema.`);
          setCatalogStatus({ status: "ready", id: entry.id, catalog: parsed.value, manifest: manifest.value });
        })
        .catch((error: unknown) => {
          setCatalogStatus({ status: "error", reason: error instanceof Error ? error.message : String(error) });
        });
    },
    useFacetDetail: () => ({ status: "error", reason: "Not built yet · WP-S14" }),
  };
}

let loader: CatalogLoader = minimalLoader();

/** S14 registers its loader at module evaluation. Returns a disposer that restores the previous one. */
export function provideCatalogLoader(provided: CatalogLoader): () => void {
  const previous = loader;
  loader = provided;
  return () => {
    if (loader === provided) loader = previous;
  };
}

/** Publishes the catalog's status (the loader, and the test harness). */
export function setCatalogStatus(status: CatalogStatus): void {
  store.setState({ status });
}

/** `main.tsx` calls this once with the manifest. */
export function startCatalog(manifest: Result<CatalogManifest, string>): void {
  loader.start(manifest);
}

/** The loaded catalog, or null while loading or after an error. Non-reactive. */
export function getCatalog(): Catalog | null {
  const { status } = store.getState();
  return status.status === "ready" ? status.catalog : null;
}

export function getCatalogStatus(): CatalogStatus {
  return store.getState().status;
}

export function useCatalogStatus(): CatalogStatus {
  return useStore(store, (s) => s.status);
}

/** The loaded catalog, or null while loading or after an error. */
export function useCatalog(): Catalog | null {
  return useStore(store, (s) => (s.status.status === "ready" ? s.status.catalog : null));
}

export function useFacetDetail(name: string): FacetDetailState {
  return loader.useFacetDetail(name);
}

/** @internal The harness's reset between tests. */
export function resetCatalog(): void {
  loader = minimalLoader();
  store.setState({ status: { status: "loading" } });
}
