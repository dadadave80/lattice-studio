/**
 * The catalog pin (spec "Catalog pin", L290): a project or link opens against the catalog it names
 * (`recipe.catalog: { tag, hash }`). Pure so it's simple to test; `services.ts` wires it to the document
 * store and `index.ts` exposes it reactively for S13's read-only and migrate flow.
 */
import type { CatalogStatus } from "@/contracts";
import type { Hex } from "@lattice-studio/core";
import { defaultEntry, findEntry, type ManifestEntry } from "./lookup";

export type CatalogPinRef = { tag: string; hash: Hex };

/** K2's untitled project's placeholder before S1 pins the loaded catalog into it (CCR 2026-09-23, S7a). */
export const UNPINNED_HASH: Hex = `0x${"00".repeat(32)}`;

export type CatalogPin =
  /** The catalog isn't loaded yet, or loaded with no manifest to check against (e.g. a seeded test). */
  | { status: "unknown" }
  /** A fresh project with no catalog pin yet (`UNPINNED_HASH`): nothing to match, bundle or migrate. */
  | { status: "unpinned" }
  /** The project's catalog is the one on screen. */
  | { status: "matches" }
  /** Bundled, but under a different manifest entry than the one loaded. */
  | { status: "bundled"; entry: ManifestEntry }
  /** Studio no longer bundles this catalog (spec L290): read-only, with the catalog to migrate to (if any). */
  | { status: "unbundled"; migrateTo: ManifestEntry | null };

function sameHash(a: Hex, b: Hex): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

export function resolveCatalogPin(ref: CatalogPinRef, status: CatalogStatus): CatalogPin {
  if (sameHash(ref.hash, UNPINNED_HASH)) return { status: "unpinned" };
  if (status.status !== "ready") return { status: "unknown" };
  if (sameHash(ref.hash, status.catalog.hash)) return { status: "matches" };
  if (!status.manifest) return { status: "unknown" };
  const entry = findEntry(status.manifest, ref.hash);
  if (entry) return { status: "bundled", entry };
  return { status: "unbundled", migrateTo: defaultEntry(status.manifest) ?? null };
}
