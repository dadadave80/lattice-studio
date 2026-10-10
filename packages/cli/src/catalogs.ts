/**
 * The catalogs the CLI checks against: the one it ships (the manifest's default at build time, bundled into
 * `dist/main.js`), or the ones in a directory given with `--catalog <dir>` (a `catalog/` folder with
 * `manifest.json`, or one `catalog/<id>/` folder with `index.json`). Every index must hash to its own `hash`
 * (and to the manifest's entry), or the command stops with exit 3.
 */
import { readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  type Catalog,
  catalogHash,
  err,
  type Hex,
  isHexAnyCase,
  ok,
  type ParseIssue,
  type Result,
  validateCatalog,
  validateCatalogManifest,
} from "@lattice-studio/core";
import bundledIndex from "../../../catalog/dev-6c8db45/index.json" with { type: "json" };
import bundledProxyCode from "../../../catalog/dev-6c8db45/code/Lattice.creation.hex" with { type: "text" };
import { catalogMismatch, errorMessage, type Failure, invalid } from "./failure";

/** The id of the catalog bundled into the CLI; a test keeps it equal to `catalog/manifest.json`'s default. */
export const BUNDLED_CATALOG_ID = "dev-6c8db45";

/** A catalog plus where it came from and how to get the `Lattice` proxy's creation code (CreateX exports). */
export type LoadedCatalog = {
  catalog: Catalog;
  /** "the bundled catalog" or the index file's path, for messages. */
  source: string;
  proxyCode: () => Promise<Result<Hex, string>>;
};

export type CatalogSet = { catalogs: LoadedCatalog[]; fallback: LoadedCatalog };

function describeIssues(file: string, issues: readonly ParseIssue[]): string {
  return issues
    .slice(0, 5)
    .map((issue) => `${file}: ${issue.path === "" ? "" : `${issue.path} `}${issue.message}`)
    .join("\n");
}

function checkHash(catalog: Catalog, file: string): Failure | null {
  const actual = catalogHash(catalog);
  if (actual.toLowerCase() === catalog.hash.toLowerCase()) return null;
  return catalogMismatch(`${file} says its hash is ${catalog.hash}, but its contents hash to ${actual}. Rebuild the catalog with bun run catalog.`);
}

/** The catalog bundled into the CLI, validated. */
export function bundledCatalogs(): Result<CatalogSet, Failure> {
  const parsed = validateCatalog(bundledIndex);
  if (!parsed.ok) return err(invalid(`The bundled catalog doesn't validate.\n${describeIssues("index.json", parsed.error)}`));
  const mismatch = checkHash(parsed.value, "The bundled catalog");
  if (mismatch !== null) return err(mismatch);
  const loaded: LoadedCatalog = {
    catalog: parsed.value,
    source: "the bundled catalog",
    proxyCode: () => Promise.resolve(isHexAnyCase(bundledProxyCode) ? ok(bundledProxyCode) : err("The bundled Lattice proxy creation code isn't hex.")),
  };
  return ok({ catalogs: [loaded], fallback: loaded });
}

async function readJson(file: string): Promise<Result<unknown, string>> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    return err(`${file} can't be read: ${errorMessage(error)}`);
  }
  try {
    return ok(JSON.parse(text));
  } catch {
    return err(`${file} isn't valid JSON.`);
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function loadIndex(file: string, expectedHash?: Hex): Promise<Result<LoadedCatalog, Failure>> {
  const json = await readJson(file);
  if (!json.ok) return err(invalid(json.error));
  const parsed = validateCatalog(json.value);
  if (!parsed.ok) return err(invalid(`${file} isn't a catalog index.\n${describeIssues(file, parsed.error)}`));
  const catalog = parsed.value;
  const mismatch = checkHash(catalog, file);
  if (mismatch !== null) return err(mismatch);
  if (expectedHash !== undefined && expectedHash.toLowerCase() !== catalog.hash.toLowerCase()) {
    return err(catalogMismatch(`manifest.json lists ${catalog.lattice.tag} with hash ${expectedHash}, but ${file} has ${catalog.hash}.`));
  }
  const codeFile = join(dirname(file), catalog.proxy.creationCode.path);
  const proxyCode = async (): Promise<Result<Hex, string>> => {
    try {
      const text = (await readFile(codeFile, "utf8")).trim();
      return isHexAnyCase(text) ? ok(text) : err(`${codeFile} isn't hex.`);
    } catch (error) {
      return err(`${codeFile} can't be read: ${errorMessage(error)}`);
    }
  };
  return ok({ catalog, source: file, proxyCode });
}

/** The catalogs in `dir`: every entry of its `manifest.json` (the default first), or its one `index.json`. */
export async function readCatalogDir(dir: string): Promise<Result<CatalogSet, Failure>> {
  const root = resolve(dir);
  const manifestFile = join(root, "manifest.json");
  if (await exists(manifestFile)) {
    const json = await readJson(manifestFile);
    if (!json.ok) return err(invalid(json.error));
    const manifest = validateCatalogManifest(json.value);
    if (!manifest.ok) return err(invalid(`${manifestFile} isn't a catalog manifest.\n${describeIssues(manifestFile, manifest.error)}`));
    const catalogs: LoadedCatalog[] = [];
    let fallback: LoadedCatalog | undefined;
    for (const entry of manifest.value.catalogs) {
      const loaded = await loadIndex(join(root, entry.path), entry.hash);
      if (!loaded.ok) return loaded;
      catalogs.push(loaded.value);
      if (entry.id === manifest.value.default) fallback = loaded.value;
    }
    if (fallback === undefined) return err(invalid(`${manifestFile} names ${manifest.value.default} as its default, but doesn't list it.`));
    return ok({ catalogs: [fallback, ...catalogs.filter((c) => c !== fallback)], fallback });
  }
  const indexFile = join(root, "index.json");
  if (await exists(indexFile)) {
    const loaded = await loadIndex(indexFile);
    if (!loaded.ok) return loaded;
    return ok({ catalogs: [loaded.value], fallback: loaded.value });
  }
  return err(invalid(`${root} has neither manifest.json nor index.json. Pass a catalog folder: catalog/ or catalog/<id>/.`));
}

/** "Lattice 0.4.0" for the tag "v0.4.0"; other tags as they are (C1's wording). */
export function latticeName(catalog: Catalog): string {
  return `Lattice ${catalog.lattice.tag.replace(/^v(?=[0-9])/, "")}`;
}
