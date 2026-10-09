/**
 * The parts of the loaded catalog that load on first use (Q15): template recipes (`recipes.json`), when a recipe
 * loads or a deployment is checked against the templates, and init parameter help (`init-docs.json`), when the
 * init editor first shows it. Each file is fetched once per catalog, checked against its `ShardRef.hash` and
 * validated; a failure is said, with why, and the next use tries again. An index that carries both inline (the
 * fixtures, catalogs written before Q15) never fetches either.
 *
 * Neither part is published as a new "loaded" catalog: everything subscribed to the catalog would re-run (the
 * analysis, chain probes), and the index's `hash` no longer hashes a catalog with its parts put back. Callers take
 * the catalog these functions return for the one call that needs it.
 */
import { useSyncExternalStore } from "react";
import type { Catalog, InitDocsShard, ParseIssue, RecipesShard, Result, ShardRef } from "@lattice-studio/core";
import { err, findProtoKey, ok, withInitDocs, withRecipes } from "@lattice-studio/core";
import { getCatalogStatus, subscribeCatalog, type CatalogStatus } from "@/contracts";
import { catalogDirFor, fetchVerified } from "./lookup";

type Ready = Extract<CatalogStatus, { status: "ready" }>;

async function fetchPart<T>(
  status: Ready,
  ref: ShardRef,
  validate: (json: unknown) => Result<T, ParseIssue[]>,
): Promise<Result<T, string>> {
  const text = await fetchVerified(status.id, catalogDirFor(status.id, status.manifest), ref);
  if (!text.ok) return text;
  let json: unknown;
  try {
    json = JSON.parse(text.value);
  } catch {
    return err(`${ref.path} isn't valid JSON.`);
  }
  if (findProtoKey(json) !== null) return err(`${ref.path} doesn't match its schema.`);
  const parsed = validate(json);
  return parsed.ok ? parsed : err(`${ref.path} doesn't match its schema.`);
}

/** The ready status whose catalog is `catalog`, or null when it isn't the one on screen. */
function readyFor(catalog: Catalog): Ready | null {
  const status = getCatalogStatus();
  return status.status === "ready" && status.catalog === catalog ? status : null;
}

// ── recipes ────────────────────────────────────────────────────────────────────────────────────────

const withRecipesCache = new WeakMap<Catalog, Promise<Result<Catalog, string>>>();

/** "Couldn't load the recipes. {reason}" (spec L695's pattern). */
export function recipesFailure(reason: string): string {
  return `Couldn't load the recipes. ${reason}`;
}

/**
 * `catalog` with every template's recipe, for `loadTemplate` (Q15): itself when it carries them inline, else a copy
 * filled from `recipes.json`. `catalog` must be the loaded one. The error is a complete sentence.
 */
export function catalogWithRecipes(catalog: Catalog): Promise<Result<Catalog, string>> {
  const ref = catalog.shards?.recipes;
  if (ref === undefined || catalog.recipes.every((template) => template.recipe !== undefined)) return Promise.resolve(ok(catalog));
  const cached = withRecipesCache.get(catalog);
  if (cached) return cached;
  const status = readyFor(catalog);
  if (!status) return Promise.resolve(err(recipesFailure("The catalog hasn't loaded.")));
  const loading = (async (): Promise<Result<Catalog, string>> => {
    const { validateRecipesShard } = await import("@lattice-studio/core/schema");
    const shard = await fetchPart<RecipesShard>(status, ref, validateRecipesShard);
    return shard.ok ? ok(withRecipes(catalog, shard.value)) : err(recipesFailure(shard.error));
  })().catch((error: unknown) => err(recipesFailure(error instanceof Error ? error.message : String(error))));
  withRecipesCache.set(catalog, loading);
  // A failure isn't kept: the next recipe command tries again.
  void loading.then((result) => {
    if (!result.ok && withRecipesCache.get(catalog) === loading) withRecipesCache.delete(catalog);
  });
  return loading;
}

// ── init docs ──────────────────────────────────────────────────────────────────────────────────────

export type InitDocsState =
  | { status: "loading" }
  /** `docs` is null when the index carries them inline: nothing to add. */
  | { status: "ready"; docs: InitDocsShard | null }
  /** `reason` completes "Couldn't load the help text. {reason}". */
  | { status: "error"; reason: string };

const LOADING: InitDocsState = { status: "loading" };
const INLINE: InitDocsState = { status: "ready", docs: null };

/** By the catalog object, so a project on another catalog never reads this one's docs. */
const docsStates = new WeakMap<Catalog, InitDocsState>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function ensureDocs(): void {
  const status = getCatalogStatus();
  if (status.status !== "ready") return;
  const { catalog } = status;
  const ref = catalog.shards?.initDocs;
  if (ref === undefined) return;
  const state = docsStates.get(catalog);
  // An error is tried again when the editor next mounts (each mount subscribes); loading and ready stay.
  if (state !== undefined && state.status !== "error") return;
  docsStates.set(catalog, LOADING);
  void (async () => {
    const { validateInitDocsShard } = await import("@lattice-studio/core/schema");
    return fetchPart<InitDocsShard>(status, ref, validateInitDocsShard);
  })()
    .catch((error: unknown) => err(error instanceof Error ? error.message : String(error)))
    .then((result) => {
      docsStates.set(catalog, result.ok ? { status: "ready", docs: result.value } : { status: "error", reason: result.error });
      emit();
    });
  if (state !== undefined) emit();
}

function subscribeDocs(onChange: () => void): () => void {
  listeners.add(onChange);
  const stopCatalog = subscribeCatalog(() => {
    ensureDocs();
    onChange();
  });
  ensureDocs();
  return () => {
    listeners.delete(onChange);
    stopCatalog();
  };
}

function docsSnapshot(): InitDocsState {
  const status = getCatalogStatus();
  if (status.status !== "ready") return LOADING;
  if (status.catalog.shards?.initDocs === undefined) return INLINE;
  return docsStates.get(status.catalog) ?? LOADING;
}

/** The loaded catalog's init parameter help, loading it on first use (Q15). */
export function useInitDocs(): InitDocsState {
  return useSyncExternalStore(subscribeDocs, docsSnapshot);
}

const withDocsCache = new WeakMap<Catalog, { docs: InitDocsShard; catalog: Catalog }>();

/** `catalog` with its init parameters' help from `docs`, the same object for the same pair, so renders stay cheap. */
export function catalogWithInitDocs(catalog: Catalog, docs: InitDocsShard): Catalog {
  const cached = withDocsCache.get(catalog);
  if (cached && cached.docs === docs) return cached.catalog;
  const filled = withInitDocs(catalog, docs);
  withDocsCache.set(catalog, { docs, catalog: filled });
  return filled;
}
