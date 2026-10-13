import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

const REPO = join(import.meta.dir, "..", "..", "..");
const CATALOG_DIR = join(REPO, "catalog");

type ManifestEntry = { id: string; tag: string; hash: string; path: string };
type Manifest = { default: string; catalogs: ManifestEntry[] };
type Template = { name: string; script: string; proxy: string; phase: string; recipe?: Record<string, unknown>; facetCount?: number };
type IndexFacet = { name: string; summary?: string };
type CatalogIndex = {
  hash?: string;
  lattice?: { tag: string };
  facets: IndexFacet[];
  recipes: Template[];
  shards?: { recipes: { path: string } };
};

export type LoadedCatalog = { entry: ManifestEntry; indexPath: string; index: CatalogIndex };
export type TemplateSummary = { name: string; facets: number; script: string };
export type CatalogPin = { tag: string; hash: string };

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

/** The default catalog named in `catalog/manifest.json`: the files Studio and the CLI bundle. */
export function loadCatalog(): LoadedCatalog {
  const manifest = readJson<Manifest>(join(CATALOG_DIR, "manifest.json"));
  const entry = manifest.catalogs.find((c) => c.id === manifest.default) ?? manifest.catalogs[0];
  if (entry === undefined) throw new Error("catalog/manifest.json lists no catalog.");
  const tried = [join(CATALOG_DIR, entry.path), join(REPO, entry.path), join(CATALOG_DIR, entry.path, "index.json"), join(REPO, entry.path, "index.json")];
  const indexPath = tried.find(isFile);
  if (indexPath === undefined) throw new Error(`No catalog index for ${entry.id} at ${entry.path}.`);
  return { entry, indexPath, index: readJson<CatalogIndex>(indexPath) };
}

/** What a recipe pins: the index's own tag and hash, which recipe files carry, else the manifest's. */
export function catalogPin(c: LoadedCatalog): CatalogPin {
  return { tag: c.index.lattice?.tag ?? c.entry.tag, hash: c.index.hash ?? c.entry.hash };
}

/** Only v1 recipes on the plain Lattice proxy load in Studio, so only those are offered. */
function loadable(template: Template): boolean {
  return template.proxy === "Lattice" && template.phase === "v1";
}

export function listTemplates(c: LoadedCatalog): TemplateSummary[] {
  return c.index.recipes.filter(loadable).map((template) => {
    const facets = template.recipe?.["facets"];
    return { name: template.name, facets: template.facetCount ?? (Array.isArray(facets) ? facets.length : 0), script: template.script };
  });
}

/** A loadable template as a recipe file, pinned to the catalog it came from; null when there's none by that name. */
export function getTemplate(c: LoadedCatalog, name: string): Record<string, unknown> | null {
  const template = c.index.recipes.find((candidate) => candidate.name === name && loadable(candidate));
  if (template === undefined) return null;
  let recipe = template.recipe;
  const shard = c.index.shards?.recipes.path;
  if (recipe === undefined && shard !== undefined) {
    const shardPath = [join(dirname(c.indexPath), shard), join(CATALOG_DIR, shard), join(REPO, shard)].find(isFile);
    if (shardPath !== undefined) recipe = readJson<Record<string, Record<string, unknown>>>(shardPath)[name];
  }
  if (recipe === undefined) return null;
  const pin = catalogPin(c);
  return {
    $schema: "https://lattice-studio.invalid/schema/recipe.v1.json",
    schemaVersion: 1,
    ...recipe,
    name: typeof recipe["name"] === "string" ? recipe["name"] : name,
    catalog: pin,
    template: { name, catalogHash: pin.hash },
  };
}

/** One line per facet for the system prompt: its name and the start of its summary. */
export function facetSummary(c: LoadedCatalog): string {
  return c.index.facets.map((facet) => (facet.summary === undefined ? facet.name : `${facet.name}: ${facet.summary.slice(0, 100)}`)).join("\n");
}
