/**
 * The real catalog loader (contracts §5.1 `CatalogLoader`, spec L695 errors, L830 shard caching). Registered
 * through `provideCatalogLoader` in `services.ts`, which also wires the document subscription that warms
 * placed facets and checks the catalog pin (spec "Catalog pin", L290).
 *
 * Every fetched file is checked against its `ShardRef.hash` (keccak256 of the file's raw bytes) before it's
 * parsed or handed out: a mismatch is reported as a shard error, never silently accepted (missing.ts does the
 * same for creation code before it builds a deploy).
 */
import { useSyncExternalStore } from "react";
import { keccak256 } from "viem";
import type { CatalogLoader, CatalogStatus, FacetDetailState } from "@/contracts";
import { getCatalogStatus, log, setCatalogStatus, subscribeCatalog } from "@/contracts";
import type { Catalog, CatalogManifest, FacetDetail, Hex, Result, ShardRef } from "@lattice-studio/core";
import { err, findProtoKey, isHex, lines, ok } from "@lattice-studio/core";
import { catalogDirFor, defaultEntry, entryDir, fetchManifest, type ManifestEntry } from "./lookup";
import { shardRef } from "./resolve";

export const NOT_LOADED = "The catalog hasn't loaded.";

type Listener = () => void;

/** What `provideCatalogLoader` takes, plus what `services.ts` and S14's own tests need beyond the frozen interface. */
export type CatalogLoaderInstance = CatalogLoader & {
  /** Prefetches a name's ABI shard if it isn't cached or loading yet (spec L830, warmed on placement). */
  warm(name: string): void;
  /** Retries the last manifest fetch (if it failed) or the last index fetch (if the manifest was fine). */
  retry(): Promise<void>;
  /** Loads a bundled, non-default manifest entry as "the loaded catalog" (a project pinned to it, spec L290). */
  switchTo(entry: ManifestEntry, manifest: CatalogManifest): Promise<void>;
  /** @internal Tests: drops every cached shard. */
  clearDetails(): void;
};

function logFirstLoad(catalog: Catalog): void {
  const version = catalog.lattice.tag.replace(/^v/, "");
  const draft =
    catalog.provisional === undefined
      ? lines.catalogLoaded({ version, facets: catalog.facets.length })
      : lines.catalogLoaded({ version, facets: catalog.facets.length, provisional: catalog.provisional });
  log(draft);
}

export function createCatalogLoader(): CatalogLoaderInstance {
  /** By `<catalog id>/<name>`, so a project on another catalog never reads this one's shard. */
  const details = new Map<string, FacetDetailState>();
  const listeners = new Set<Listener>();
  const emit = () => {
    for (const listener of listeners) listener();
  };

  let manifest: CatalogManifest | null = null;
  let lastManifestResult: Result<CatalogManifest, string> | null = null;
  let lastEntry: ManifestEntry | null = null;
  /** Bumped on every load start; a completion whose generation lags the current one is discarded (superseded). */
  let generation = 0;

  function readyId(): string | null {
    const status = getCatalogStatus();
    return status.status === "ready" ? status.id : null;
  }

  function dirFor(id: string): string {
    return catalogDirFor(id, manifest);
  }

  async function fetchBytes(id: string, ref: ShardRef): Promise<Result<string, string>> {
    let response: Response;
    try {
      response = await fetch(`${dirFor(id)}${ref.path}`);
    } catch (error) {
      return err(error instanceof Error ? error.message : String(error));
    }
    if (!response.ok) return err(`${ref.path} answered ${response.status}.`);
    const buffer = new Uint8Array(await response.arrayBuffer());
    if (keccak256(buffer).toLowerCase() !== ref.hash.toLowerCase()) {
      return err(`${ref.path} doesn't match catalog ${id}'s hash for it. Reload the catalog.`);
    }
    return ok(new TextDecoder().decode(buffer));
  }

  async function fetchShard(name: string): Promise<Result<FacetDetail, string>> {
    const status = getCatalogStatus();
    if (status.status !== "ready") return err(NOT_LOADED);
    const ref = shardRef(status.catalog, name, "detail");
    if (!ref) return err(`${name} has no ABI shard in this catalog.`);
    const text = await fetchBytes(status.id, ref);
    if (!text.ok) return text;
    let json: unknown;
    try {
      json = JSON.parse(text.value);
    } catch {
      return err(`${name}'s shard isn't valid JSON.`);
    }
    if (findProtoKey(json) !== null) return err(`${name}'s shard doesn't match the shard schema.`);
    // Validation stays out of first load (FX15): the schema chunk loads with the first catalog read.
    let validateFacetDetail: typeof import("@lattice-studio/core/schema").validateFacetDetail;
    try {
      ({ validateFacetDetail } = await import("@lattice-studio/core/schema"));
    } catch (error) {
      return err(error instanceof Error ? error.message : String(error));
    }
    const parsed = validateFacetDetail(json);
    return parsed.ok ? parsed : err(`${name}'s shard doesn't match the shard schema.`);
  }

  async function fetchCode(name: string): Promise<Result<Hex, string>> {
    const status = getCatalogStatus();
    if (status.status !== "ready") return err(NOT_LOADED);
    const ref = shardRef(status.catalog, name, "code");
    if (!ref) return err(`${name} has no creation code in this catalog.`);
    const text = await fetchBytes(status.id, ref);
    if (!text.ok) return text;
    const raw = text.value.trim().toLowerCase();
    const code = raw.startsWith("0x") ? raw : `0x${raw}`;
    return isHex(code) ? ok(code) : err(`${name}'s creation code isn't hex.`);
  }

  function ensureDetail(name: string): void {
    const id = readyId();
    if (id === null) return; // Nothing is cached until the catalog is ready.
    const key = `${id}/${name}`;
    if (details.has(key)) return;
    details.set(key, { status: "loading" });
    void fetchShard(name).then((result) => {
      if (!result.ok && result.error === NOT_LOADED) details.delete(key);
      else details.set(key, result.ok ? { status: "ready", detail: result.value } : { status: "error", reason: result.error });
      emit();
    });
  }

  async function openIndex(id: string, dir: string): Promise<Result<Catalog, string>> {
    try {
      const response = await fetch(`${dir}index.json`);
      if (!response.ok) return err(`${id}/index.json answered ${response.status}.`);
      const { validateCatalog } = await import("@lattice-studio/core/schema");
      const parsed = validateCatalog(await response.json());
      return parsed.ok ? parsed : err(`${id}/index.json doesn't match the catalog schema.`);
    } catch (error) {
      return err(error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * `announce` is false for a pin-driven `switchTo`: the app already logged its first-load line for the
   * catalog on screen, and swapping to a project's own bundled catalog isn't a fresh boot (spec L707 is
   * "First load" only).
   */
  async function load(entry: ManifestEntry, announce = true): Promise<void> {
    lastEntry = entry;
    const started = (generation += 1);
    setCatalogStatus({ status: "loading" });
    const result = await openIndex(entry.id, entryDir(entry));
    if (started !== generation) return; // A later load started before this one finished.
    if (!result.ok) {
      setCatalogStatus({ status: "error", reason: result.error });
      return;
    }
    setCatalogStatus({ status: "ready", id: entry.id, catalog: result.value, manifest });
    if (announce) logFirstLoad(result.value);
  }

  /** Returns once the catalog this manifest names has settled, so `retry` can await it. `start` doesn't. */
  async function openManifest(result: Result<CatalogManifest, string>): Promise<void> {
    lastManifestResult = result;
    if (!result.ok) {
      generation += 1;
      setCatalogStatus({ status: "error", reason: result.error });
      return;
    }
    manifest = result.value;
    const entry = defaultEntry(result.value);
    if (!entry) {
      generation += 1;
      setCatalogStatus({ status: "error", reason: `The manifest's default catalog "${result.value.default}" isn't listed.` });
      return;
    }
    await load(entry);
  }

  const LOADING: FacetDetailState = { status: "loading" };

  return {
    start(result) {
      void openManifest(result);
    },
    useFacetDetail(name) {
      return useSyncExternalStore(
        (onChange) => {
          listeners.add(onChange);
          // Loads once the catalog is ready, and again for a different catalog.
          const stopCatalog = subscribeCatalog((status: CatalogStatus) => {
            if (status.status === "ready") ensureDetail(name);
            onChange();
          });
          ensureDetail(name);
          return () => {
            listeners.delete(onChange);
            stopCatalog();
          };
        },
        () => {
          const id = readyId();
          return (id === null ? undefined : details.get(`${id}/${name}`)) ?? LOADING;
        },
      );
    },
    loadShard: fetchShard,
    loadCode: fetchCode,
    warm: ensureDetail,
    async retry() {
      if (!lastManifestResult || !lastManifestResult.ok) {
        await openManifest(await fetchManifest());
        return;
      }
      if (lastEntry) {
        await load(lastEntry);
        return;
      }
      await openManifest(lastManifestResult);
    },
    async switchTo(entry, sourceManifest) {
      manifest = sourceManifest;
      await load(entry, false);
    },
    clearDetails() {
      details.clear();
    },
  };
}
