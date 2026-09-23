/**
 * Manifest and catalog-by-id lookups, independent of the single "loaded" catalog `contracts/catalog.ts`
 * publishes: the migrate flow (S13) and this module's own pin check need to ask about a catalog other than
 * the one on screen, without disturbing it.
 */
import type { Catalog, CatalogManifest, Hex, Result } from "@lattice-studio/core";
import { err, ok, validateCatalog, validateCatalogManifest } from "@lattice-studio/core";
import { catalogBase } from "@/contracts";

export type ManifestEntry = CatalogManifest["catalogs"][number];

/** Fetches and validates `manifest.json`. Never throws. */
export async function fetchManifest(): Promise<Result<CatalogManifest, string>> {
  try {
    const response = await fetch(`${catalogBase()}manifest.json`);
    if (!response.ok) return err(`manifest.json answered ${response.status}.`);
    const parsed = validateCatalogManifest(await response.json());
    return parsed.ok ? parsed : err("manifest.json doesn't match the manifest schema.");
  } catch (error) {
    return err(error instanceof Error ? error.message : String(error));
  }
}

function dirOf(path: string): string {
  const clean = path.replace(/^\.?\//, "");
  return clean.endsWith(".json") ? clean.slice(0, clean.lastIndexOf("/") + 1) : `${clean.replace(/\/$/, "")}/`;
}

/** The folder a manifest entry serves from, under `/catalog/`. */
export function entryDir(entry: ManifestEntry): string {
  return `${catalogBase()}${dirOf(entry.path)}`;
}

/** The folder a loaded catalog's `id` serves from: its manifest entry's path, or the id itself with no manifest. */
export function catalogDirFor(id: string, manifest: CatalogManifest | null): string {
  const entry = manifest?.catalogs.find((candidate) => candidate.id === id);
  return entry ? entryDir(entry) : `${catalogBase()}${dirOf(id)}`;
}

/** The manifest entry a project's `recipe.catalog` names, by hash (the canonical identity; `tag` is display only). */
export function findEntry(manifest: CatalogManifest, hash: Hex): ManifestEntry | undefined {
  return manifest.catalogs.find((entry) => entry.hash.toLowerCase() === hash.toLowerCase());
}

export function defaultEntry(manifest: CatalogManifest): ManifestEntry | undefined {
  return manifest.catalogs.find((entry) => entry.id === manifest.default);
}

const byId = new Map<string, Catalog>();

/** A catalog by its manifest entry, cached by id. Never touches the "loaded" status. */
export async function loadCatalogById(entry: ManifestEntry): Promise<Result<Catalog, string>> {
  const cached = byId.get(entry.id);
  if (cached) return ok(cached);
  try {
    const response = await fetch(`${entryDir(entry)}index.json`);
    if (!response.ok) return err(`${entry.id}/index.json answered ${response.status}.`);
    const parsed = validateCatalog(await response.json());
    if (!parsed.ok) return err(`${entry.id}/index.json doesn't match the catalog schema.`);
    byId.set(entry.id, parsed.value);
    return ok(parsed.value);
  } catch (error) {
    return err(error instanceof Error ? error.message : String(error));
  }
}

/** @internal Tests: drops the by-id cache. */
export function clearCatalogCache(): void {
  byId.clear();
}
