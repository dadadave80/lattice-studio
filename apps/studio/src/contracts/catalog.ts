/**
 * The loaded catalog (contracts §4, §5.1 hooks). `main.tsx` fetches the manifest and hands it to
 * `startCatalog`; the catalog loader (K2's minimal one, then S14's) loads an index and publishes it with
 * `setCatalogStatus`. Detail shards and creation code load on demand: `useFacetDetail` in render,
 * `loadFacetDetail` and `loadCreationCode` elsewhere (revert decoding, missing-contract deploys).
 */
import type { Catalog, CatalogManifest, FacetDetail, Hex, Result, ShardRef } from "@lattice-studio/core";
import { isHex, validateCatalog, validateFacetDetail } from "@lattice-studio/core";
import { useSyncExternalStore } from "react";
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
  /** A hook: the detail shard of a facet or shared contract, loading it on first use. */
  useFacetDetail(name: string): FacetDetailState;
  /**
   * The ABI shard of a facet, or of a shared contract that has one (`SharedContract.detail`: LatticeRegistry,
   * LatticeFactory, init contracts), plus "Lattice" for the proxy (`catalog.proxy.detail`).
   */
  loadShard(name: string): Promise<Result<FacetDetail, string>>;
  /** Creation code of a shared contract by name, or "Lattice" for the proxy (`code/<Name>.creation.hex`). */
  loadCode(name: string): Promise<Result<Hex, string>>;
};

const store = createStore<{ status: CatalogStatus }>(() => ({ status: { status: "loading" } }));

/** Where catalogs are served: `/catalog/` under the app's base. */
export function catalogBase(): string {
  const base = import.meta.env.BASE_URL ?? "/";
  return `${base.endsWith("/") ? base : `${base}/`}catalog/`;
}

function dirOf(path: string): string {
  const clean = path.replace(/^\.?\//, "");
  return clean.endsWith(".json") ? clean.slice(0, clean.lastIndexOf("/") + 1) : `${clean.replace(/\/$/, "")}/`;
}

/** The loaded catalog's folder under `/catalog/`, from its manifest entry (or its id). */
function catalogDir(status: Extract<CatalogStatus, { status: "ready" }>): string {
  const entry = status.manifest?.catalogs.find((c) => c.id === status.id);
  return `${catalogBase()}${dirOf(entry?.path ?? status.id)}`;
}

function shardRef(catalog: Catalog, name: string, kind: "detail" | "code"): ShardRef | undefined {
  if (name === "Lattice") return kind === "detail" ? catalog.proxy.detail : catalog.proxy.creationCode;
  const facet = catalog.facets.find((f) => f.name === name);
  if (facet) return kind === "detail" ? facet.detail : facet.release.creationCode;
  const shared =
    name === "LatticeRegistry" ? catalog.registry
    : name === "LatticeFactory" ? catalog.factory
    : catalog.inits.find((i) => i.name === name)?.release;
  return kind === "detail" ? shared?.detail : shared?.creationCode;
}

async function fetchRef(name: string, kind: "detail" | "code"): Promise<Result<string, string>> {
  const status = store.getState().status;
  if (status.status !== "ready") return { ok: false, error: "The catalog hasn't loaded." };
  const ref = shardRef(status.catalog, name, kind);
  if (!ref) return { ok: false, error: `${name} has no ${kind === "detail" ? "ABI shard" : "creation code"} in this catalog.` };
  try {
    const response = await fetch(`${catalogDir(status)}${ref.path}`);
    if (!response.ok) return { ok: false, error: `${ref.path} answered ${response.status}.` };
    return { ok: true, value: await response.text() };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function minimalLoader(): CatalogLoader {
  const details = new Map<string, FacetDetailState>();
  const changed = new Set<() => void>();
  const loadShard: CatalogLoader["loadShard"] = async (name) => {
    const text = await fetchRef(name, "detail");
    if (!text.ok) return text;
    let json: unknown;
    try {
      json = JSON.parse(text.value);
    } catch {
      return { ok: false, error: `${name}'s shard isn't valid JSON.` };
    }
    const parsed = validateFacetDetail(json);
    return parsed.ok ? parsed : { ok: false, error: `${name}'s shard doesn't match the shard schema.` };
  };
  const ensure = (name: string) => {
    if (details.has(name)) return;
    details.set(name, { status: "loading" });
    void loadShard(name).then((result) => {
      details.set(name, result.ok ? { status: "ready", detail: result.value } : { status: "error", reason: result.error });
      for (const fn of Array.from(changed)) fn();
    });
  };
  const LOADING: FacetDetailState = { status: "loading" };
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
      const path = entry.path.replace(/^\.?\//, "");
      const url = `${catalogBase()}${path.endsWith(".json") ? path : `${path.replace(/\/$/, "")}/index.json`}`;
      fetch(url)
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
    useFacetDetail(name) {
      return useSyncExternalStore(
        (onChange) => {
          changed.add(onChange);
          ensure(name);
          return () => {
            changed.delete(onChange);
          };
        },
        () => details.get(name) ?? LOADING,
      );
    },
    loadShard,
    async loadCode(name) {
      const text = await fetchRef(name, "code");
      if (!text.ok) return text;
      const raw = text.value.trim().toLowerCase();
      const code = raw.startsWith("0x") ? raw : `0x${raw}`;
      return isHex(code) ? { ok: true, value: code } : { ok: false, error: `${name}'s creation code isn't hex.` };
    },
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

/** Subscribes to catalog status changes, outside React. */
export function subscribeCatalog(listener: (status: CatalogStatus) => void): () => void {
  return store.subscribe((s) => listener(s.status));
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

/** A detail shard outside React (see `CatalogLoader.loadShard`). */
export function loadFacetDetail(name: string): Promise<Result<FacetDetail, string>> {
  return loader.loadShard(name);
}

/** Creation code outside React (see `CatalogLoader.loadCode`). */
export function loadCreationCode(name: string): Promise<Result<Hex, string>> {
  return loader.loadCode(name);
}

/** @internal Contract tests: K2's loader, status loading. Returns a disposer that restores both. */
export function resetCatalog(): () => void {
  const saved = { loader, status: store.getState().status };
  loader = minimalLoader();
  store.setState({ status: { status: "loading" } });
  return () => {
    loader = saved.loader;
    store.setState({ status: saved.status });
  };
}
