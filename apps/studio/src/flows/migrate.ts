/**
 * Migrate (spec L290, L494): loads the two catalogs the review compares, and applies the migration as a new
 * start for the project's history ("Migrated to catalog 0.4.1. Undo history starts here.").
 */
import type { Catalog, Project, Result } from "@lattice-studio/core";
import { err, ok } from "@lattice-studio/core";
import { announce, doc, getCatalogStatus, type CatalogStatus } from "@/contracts";
import { findEntry, loadCatalogById, type ManifestEntry } from "@/catalog/lookup";
import { migratedLine } from "./copy";
import type { MigrationReview } from "./migrate-diff";
import { migrationTarget } from "./read-only";

export type MigrationSides = { from: Catalog | null; to: Catalog };

export type SidesDeps = {
  status?: () => CatalogStatus;
  loadCatalog?: (entry: ManifestEntry) => Promise<Result<Catalog, string>>;
};

/**
 * The project's own catalog (null when this build doesn't bundle it) and the target: `targetId` when given,
 * else where Migrate goes (`migrationTarget`).
 */
export async function loadMigrationSides(project: Project, targetId: string | undefined, deps: SidesDeps = {}): Promise<Result<MigrationSides, string>> {
  const status = (deps.status ?? getCatalogStatus)();
  if (status.status !== "ready") return err("The catalog hasn't loaded yet.");
  const load = deps.loadCatalog ?? loadCatalogById;
  const byEntry = async (entry: ManifestEntry): Promise<Result<Catalog, string>> =>
    entry.id === status.id ? ok(status.catalog) : load(entry);
  const manifest = status.manifest;
  const named = targetId === undefined ? undefined : manifest?.catalogs.find((c) => c.id === targetId);
  const fallback = migrationTarget(project.recipe.catalog, status);
  const entry = named ?? (fallback.ok ? fallback.entry : undefined);
  if (!entry) return err(fallback.ok ? "This build bundles no catalog to migrate to." : `${fallback.reason}.`);
  const to = await byEntry(entry);
  if (!to.ok) return err(`Couldn't load catalog ${entry.tag}. ${to.error}`);
  const own = manifest ? findEntry(manifest, project.recipe.catalog.hash) : undefined;
  if (!own) return ok({ from: null, to: to.value });
  const from = await byEntry(own);
  return ok({ from: from.ok ? from.value : null, to: to.value });
}

/** The project on the target catalog: facets it lacks leave the sheet, and history starts over. */
export function applyMigration(project: Project, review: MigrationReview): Project {
  const keep = new Set(review.recipe.facets);
  const layout: Project["layout"] = {};
  for (const [name, entry] of Object.entries(project.layout)) if (keep.has(name)) layout[name] = entry;
  const next: Project = { ...project, recipe: review.recipe, layout };
  const line = migratedLine(review.toTag);
  doc.load(next, line);
  announce(line);
  return next;
}
