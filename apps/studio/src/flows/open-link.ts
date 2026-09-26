/**
 * Opening a shared link (Flow 10 step 7, spec L291, L504, L709, L857). The link opens against the catalog it
 * names: the loaded one, another bundled one, or (not bundled) none, which leaves the project read-only with
 * Migrate. It becomes a new project, "GovernedVault (shared)", with its sheet tidied, every literal argument
 * marked From link (LINK-01 blocks deploy until each authority address is confirmed) and a banner with the
 * link's recipe hash. Nothing runs. A link Studio can't read, or one from a newer Studio, is refused with why.
 * Loaded on use: it carries the codec.
 */
import type { Analysis, Catalog, CatalogManifest, Layout, Project, Recipe, Result } from "@lattice-studio/core";
import {
  analyze, argProvenance, decodeShareLink, err, formatParseIssue, isNotImplemented, lines, ok, tidy,
} from "@lattice-studio/core";
import {
  announce, commandRef, createProject, doc, emptyAnalysis, getCatalogStatus, hideBanner, isPlaceholder, layoutMetrics, log,
  runCommand, showBanner, subscribeCatalog, toast, type CatalogStatus,
} from "@/contracts";
import { findEntry, loadCatalogById, type ManifestEntry } from "@/catalog/lookup";
import { sharedLinkBanner, SHARED_LINK_BANNER } from "./copy";

export type OpenLinkDeps = {
  /** The catalog once it's ready or failed. Default: waits on the contracts' catalog status. */
  catalog?: () => Promise<CatalogStatus>;
  /** A bundled catalog other than the loaded one. Default: S14's `loadCatalogById`. */
  loadCatalog?: (entry: ManifestEntry) => Promise<Result<Catalog, string>>;
};

/** Resolves once the catalog has loaded or failed: a link opened at boot arrives before it does. */
export function settledCatalog(): Promise<CatalogStatus> {
  const now = getCatalogStatus();
  if (now.status !== "loading") return Promise.resolve(now);
  return new Promise((resolve) => {
    const stop = subscribeCatalog((status) => {
      if (status.status === "loading") return;
      stop();
      resolve(status);
    });
  });
}

/** "GovernedVault (shared)": the recipe's name, else its template's (spec L504). Opening a shared copy again doesn't stack. */
export function sharedName(recipe: Recipe): string {
  const base = (recipe.name ?? recipe.template?.name ?? "Untitled").replace(/ \(shared\)$/, "").trim();
  return `${base === "" ? "Untitled" : base} (shared)`;
}

function analysisOf(recipe: Recipe, catalog: Catalog): Analysis {
  try {
    return analyze(recipe, catalog);
  } catch (error) {
    if (isNotImplemented(error)) return emptyAnalysis();
    throw error;
  }
}

/** The sheet tidied on open (spec L291): the link carries no layout. */
export function tidiedLayout(recipe: Recipe, catalog: Catalog | null): Layout {
  if (catalog === null) return {};
  try {
    const project: Project = { ...doc.get(), recipe, layout: {}, provenance: {} };
    return tidy(project, catalog, analysisOf(recipe, catalog), layoutMetrics);
  } catch (error) {
    if (isNotImplemented(error)) return {};
    throw error;
  }
}

function manifestOf(status: CatalogStatus): CatalogManifest | null {
  return status.status === "ready" ? status.manifest : null;
}

/** The fragment goes once the project exists, so a reload reopens that project instead of another copy. */
function clearFragment(): void {
  if (typeof location === "undefined" || !location.hash.startsWith("#s=")) return;
  history.replaceState(history.state, "", `${location.pathname}${location.search}`);
}

let stopWatching: (() => void) | null = null;

/** The banner stays with the project the link opened; opening another project takes it down. */
function watchBanner(projectId: string): void {
  stopWatching?.();
  const stop = doc.subscribe(() => {
    if (doc.get().id === projectId) return;
    hideBanner(SHARED_LINK_BANNER);
    stop();
    if (stopWatching === stop) stopWatching = null;
  });
  stopWatching = stop;
}

function refuse(reason: string): Result<Project, string> {
  toast({ text: `This link couldn't be opened: ${reason}`, kind: "error" });
  return err(reason);
}

/** Opens `link` (a `#s=1.…` fragment or a whole URL) as a new project. Every outcome is said. */
export async function openShareLink(link: string, deps: OpenLinkDeps = {}): Promise<Result<Project, string>> {
  const status = await (deps.catalog ?? settledCatalog)();
  const loaded = status.status === "ready" ? status.catalog : null;
  const catalogs = loaded ? [loaded] : [];
  let decoded = decodeShareLink(link, catalogs);
  const manifest = manifestOf(status);
  if (decoded.ok && decoded.value.catalog === null && manifest) {
    // Bundled, but not the catalog on screen: decode again against it, since typed normalization differs.
    const entry = findEntry(manifest, decoded.value.recipe.catalog.hash);
    if (entry) {
      const other = await (deps.loadCatalog ?? loadCatalogById)(entry);
      if (other.ok) decoded = decodeShareLink(link, [...catalogs, other.value]);
    }
  }
  if (!decoded.ok) return refuse(decoded.error.map(formatParseIssue).join(" "));

  const shared = decoded.value;
  const layout = tidiedLayout(shared.recipe, shared.catalog ?? loaded);
  const provenance = argProvenance(shared.recipe, shared.catalog, "link");
  const created = await createProject(shared.recipe, sharedName(shared.recipe), { layout, provenance });
  if (!created.ok) return refuse(created.error);

  const toConfirm = shared.unconfirmed.length;
  const line = lines.linkOpened({ recipeHash: shared.hash, toConfirm });
  log(line);
  announce(line.text);
  showBanner(SHARED_LINK_BANNER, {
    text: sharedLinkBanner(shared.hash),
    tone: "info",
    actions: toConfirm > 0 ? [commandRef("link.confirmAddresses")] : [],
    dismissible: true,
  });
  watchBanner(created.value.id);
  clearFragment();
  if (!isPlaceholder("sheet.zoomFit")) void runCommand(commandRef("sheet.zoomFit"), "api");
  return ok(created.value);
}

/** @internal Tests: stops following the last opened link's project. */
export function resetOpenLink(): void {
  stopWatching?.();
  stopWatching = null;
}
