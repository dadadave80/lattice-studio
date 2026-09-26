/**
 * WP-S14, catalog loading. `services.ts` (imported eagerly by `contracts/discover.ts`) registers the real
 * loader; everything a project's catalog is loaded through `@/contracts` (`useCatalog`, `useFacetDetail`,
 * `getCatalogStatus`, …). This module's own exports are for the modules that need more than that frozen
 * surface: S5a's Retry, and S13's migrate and read-only flow.
 */
export type { CatalogPin, CatalogPinRef } from "./pin";
export { resolveCatalogPin, UNPINNED_HASH } from "./pin";
export { getCatalogPin, subscribeCatalogPin, useCatalogPin } from "./pin-store";
export { catalogDirFor, defaultEntry, entryDir, fetchManifest, findEntry, loadCatalogById, type ManifestEntry } from "./lookup";
export { resolveRelease, shardRef, type ResolvedRelease } from "./resolve";
export { hasCachedIndex, overrideCachedIndex } from "./cached-index";

import { getCatalogStatus, startCatalog } from "@/contracts";
import { fetchManifest as fetchManifestJson } from "./lookup";

/**
 * Retries a failed or in-flight catalog load: re-fetches `manifest.json` and reopens the catalog. S5a's
 * Retry control ("Couldn't load the catalog. {reason}") calls this; it's the only thing that does, since
 * `main.tsx` calls `startCatalog` itself just once.
 */
export async function retryCatalog(): Promise<void> {
  startCatalog(await fetchManifestJson());
}

/** Whether the loaded catalog is a fixture build: it can't deploy (contracts §4; the chain module disables Deploy). */
export function isFixtureCatalog(): boolean {
  const status = getCatalogStatus();
  return status.status === "ready" && status.catalog.lattice.tag === "fixture";
}
