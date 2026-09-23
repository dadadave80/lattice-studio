/**
 * The catalog writer (contracts §4): assembles a `Catalog` index from raw release data plus shard, code and
 * standard-JSON content, computes every `ShardRef` and the top-level `hash` (C1's `catalogHash`, over C1's
 * `canonicalJson`), and writes `catalog/<id>/` atomically, updating `catalog/manifest.json`.
 *
 * The input types below mirror the frozen `Catalog` shape (contracts §3.1) with every `ShardRef` this writer
 * computes replaced by the raw content it's computed from: `creationCode` is the hex string a `code/*.hex` file
 * holds, `detail` and `standardJson` are the JSON value a `shards/*.json` or `json/*.standard.json` file holds.
 * Everything else (addresses, hashes, salts, overlay data) is already final and passes straight through.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  type Address,
  type Catalog,
  type CatalogManifest,
  catalogHash,
  type ChainRelease,
  err,
  type Facet,
  type FacetDetail,
  type Hex,
  type InitSpec,
  ok,
  type RecipeTemplate,
  type Result,
  type Seam,
  type SharedContract,
  validateCatalog,
  validateCatalogManifest,
} from "@lattice-studio/core";
import { codePath, detailPath, jsonFileBytes, shardRefFor, standardJsonPath, textFileBytes } from "./shards";

/** A shared contract's release data, with `creationCode` and `detail` as raw content instead of `ShardRef`s. */
export type SharedContractInput = Omit<SharedContract, "creationCode" | "detail"> & {
  /** The exact text a `code/<name>.creation.hex` file holds, e.g. `"0x608060..."`. */
  creationCode: string;
  detail?: FacetDetail;
};

/** A facet, with `release` and `detail` as raw content. */
export type FacetInput = Omit<Facet, "release" | "detail"> & {
  release: SharedContractInput;
  detail: FacetDetail;
};

/** An init contract, with `release` (when it's a shared contract, not deployed per use) as raw content. */
export type InitSpecInput = Omit<InitSpec, "release"> & { release?: SharedContractInput };

/** A per-chain release, with the chain-specific factory's standard JSON as raw content. */
export type ChainReleaseInput = Omit<ChainRelease, "factory"> & {
  factory?: Omit<NonNullable<ChainRelease["factory"]>, "proxyStandardJson"> & { proxyStandardJson: unknown };
};

/** A linked library released as a shared contract (contracts §3.1 `Catalog.libraries`, e.g. PoseidonT3). */
export type LibraryInput = { name: string; release: SharedContractInput };

/** The Lattice proxy, with `creationCode`, `standardJson` and `detail` as raw content. */
export type ProxyInput = { creationCode: string; initCodeHash: Hex; standardJson: unknown; detail?: FacetDetail };

/** Everything `writeCatalog` needs to assemble one catalog (contracts §3.1 `Catalog`, minus its `ShardRef`s). */
export type CatalogInput = {
  lattice: Catalog["lattice"];
  toolchain: Catalog["toolchain"];
  deployer: Catalog["deployer"];
  registry: SharedContractInput;
  factory: SharedContractInput;
  proxy: ProxyInput;
  facets: FacetInput[];
  inits: InitSpecInput[];
  recipes: RecipeTemplate[];
  chains: ChainReleaseInput[];
  seams: Seam[];
  provisional?: string;
  libraries?: LibraryInput[];
  registryOwner?: Address;
};

/** One file this writer produces, relative to `catalog/<id>/`. */
export type CatalogFile = { path: string; bytes: Uint8Array };

/** `assembleCatalog`'s result: the finished index and every file that backs it (`index.json` included). */
export type AssembledCatalog = { catalog: Catalog; files: CatalogFile[] };

const ZERO_HASH: Hex = `0x${"00".repeat(32)}`;

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Registers one file's bytes under its path, throwing if the same path was already registered with different content. */
class FileRegistry {
  private readonly files = new Map<string, Uint8Array>();

  put(path: string, bytes: Uint8Array): void {
    const existing = this.files.get(path);
    if (existing !== undefined) {
      if (!bytesEqual(existing, bytes)) {
        throw new Error(`catalog-gen: ${path} was given two different contents (two release entries disagree)`);
      }
      return;
    }
    this.files.set(path, bytes);
  }

  json(path: string, value: unknown): ReturnType<typeof shardRefFor> {
    const bytes = jsonFileBytes(value);
    this.put(path, bytes);
    return shardRefFor(path, bytes);
  }

  text(path: string, value: string): ReturnType<typeof shardRefFor> {
    const bytes = textFileBytes(value);
    this.put(path, bytes);
    return shardRefFor(path, bytes);
  }

  entries(): CatalogFile[] {
    return [...this.files].map(([path, bytes]) => ({ path, bytes }));
  }
}

/**
 * Builds by spreading the rest of `input` (everything but the fields being turned into `ShardRef`s), not by
 * listing every known field: a field this writer doesn't know about (an overlay or provenance addition, such
 * as an `InitSpec.afterSource` citation) still round-trips, the way C1's recipe parsing keeps unknown fields.
 */
function buildSharedContract(files: FileRegistry, name: string, input: SharedContractInput): SharedContract {
  const { creationCode, detail, ...rest } = input;
  const out: SharedContract = { ...rest, creationCode: files.text(codePath(name), creationCode) };
  if (detail !== undefined) out.detail = files.json(detailPath(name), detail);
  return out;
}

function buildFacet(files: FileRegistry, input: FacetInput): Facet {
  const { release, detail, ...rest } = input;
  return {
    ...rest,
    release: buildSharedContract(files, input.name, release),
    detail: files.json(detailPath(input.name), detail),
  };
}

function buildInitSpec(files: FileRegistry, input: InitSpecInput): InitSpec {
  const { release, ...rest } = input;
  if (release === undefined) return { ...rest };
  return { ...rest, release: buildSharedContract(files, input.contract, release) };
}

function buildProxy(files: FileRegistry, input: ProxyInput): Catalog["proxy"] {
  const { creationCode, standardJson, detail, ...rest } = input;
  const out: Catalog["proxy"] = {
    ...rest,
    creationCode: files.text(codePath("Lattice"), creationCode),
    standardJson: files.json(standardJsonPath("Lattice"), standardJson),
  };
  if (detail !== undefined) out.detail = files.json(detailPath("Lattice"), detail);
  return out;
}

function buildChainRelease(files: FileRegistry, input: ChainReleaseInput): ChainRelease {
  const { factory, ...rest } = input;
  if (factory === undefined) return { ...rest };
  const { proxyStandardJson, ...restFactory } = factory;
  const path = standardJsonPath(`Factory-${input.chainId}`);
  return { ...rest, factory: { ...restFactory, proxyStandardJson: files.json(path, proxyStandardJson) } };
}

function buildLibrary(files: FileRegistry, input: LibraryInput): { name: string; release: SharedContract } {
  return { ...input, release: buildSharedContract(files, input.name, input.release) };
}

/**
 * Builds the catalog index and every file it references, deterministically: the same input always produces
 * the same bytes and the same `hash`. Pure — no file system access, so it's safe to call any number of times.
 */
export function assembleCatalog(input: CatalogInput): AssembledCatalog {
  const files = new FileRegistry();
  const registry = buildSharedContract(files, "LatticeRegistry", input.registry);
  const factory = buildSharedContract(files, "LatticeFactory", input.factory);
  const proxy = buildProxy(files, input.proxy);
  const facets = input.facets.map((facet) => buildFacet(files, facet));
  const inits = input.inits.map((init) => buildInitSpec(files, init));
  const chains = input.chains.map((chain) => buildChainRelease(files, chain));
  const libraries = input.libraries?.map((library) => buildLibrary(files, library));

  const withoutHash: Omit<Catalog, "hash"> = {
    lattice: input.lattice,
    toolchain: input.toolchain,
    deployer: input.deployer,
    registry,
    factory,
    proxy,
    facets,
    inits,
    recipes: input.recipes,
    chains,
    seams: input.seams,
    ...(input.provisional !== undefined ? { provisional: input.provisional } : {}),
    ...(libraries !== undefined ? { libraries } : {}),
    ...(input.registryOwner !== undefined ? { registryOwner: input.registryOwner } : {}),
  };
  // `catalogHash` deletes `hash` before hashing, so the placeholder's value doesn't matter.
  const hash = catalogHash({ ...withoutHash, hash: ZERO_HASH });
  const catalog: Catalog = { ...withoutHash, hash };

  const indexBytes = jsonFileBytes(catalog);
  const allFiles = files.entries();
  allFiles.push({ path: "index.json", bytes: indexBytes });
  return { catalog, files: allFiles };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function atomicWriteFile(path: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${randomUUID()}`;
  await writeFile(tmp, bytes);
  await rename(tmp, path);
}

async function readManifest(manifestPath: string): Promise<CatalogManifest> {
  try {
    const text = await readFile(manifestPath, "utf8");
    const parsed = validateCatalogManifest(JSON.parse(text));
    if (parsed.ok) return parsed.value;
  } catch {
    // No manifest yet, or it isn't valid: start fresh.
  }
  return { default: "", catalogs: [] };
}

/**
 * Upserts one entry into `catalog/manifest.json` (by `id`), written atomically. The manifest's `default` is
 * set to this id when the manifest has none yet, or when `makeDefault` says to.
 */
export async function updateManifest(
  catalogDir: string,
  entry: CatalogManifest["catalogs"][number],
  opts?: { makeDefault?: boolean },
): Promise<CatalogManifest> {
  const manifestPath = join(catalogDir, "manifest.json");
  const manifest = await readManifest(manifestPath);
  const catalogs = manifest.catalogs.filter((c) => c.id !== entry.id);
  catalogs.push(entry);
  catalogs.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const next: CatalogManifest = {
    default: opts?.makeDefault === true || manifest.default === "" ? entry.id : manifest.default,
    catalogs,
  };
  await atomicWriteFile(manifestPath, jsonFileBytes(next));
  return next;
}

/**
 * Writes one catalog to `<catalogDir>/<id>/`, atomically: every file lands in a temporary sibling directory
 * first, which is renamed into place only once everything is written, so a reader never sees a half-written
 * catalog. `catalog/manifest.json` is updated last, itself atomically (`updateManifest`).
 */
export async function writeCatalog(
  catalogDir: string,
  id: string,
  input: CatalogInput,
  opts?: { makeDefault?: boolean },
): Promise<Result<{ catalog: Catalog; dir: string; manifest: CatalogManifest }, string>> {
  const { catalog, files } = assembleCatalog(input);
  const valid = validateCatalog(catalog);
  if (!valid.ok) {
    const detail = valid.error.map((issue) => `${issue.path || "(root)"} ${issue.message}`).join("; ");
    return err(`catalog-gen: assembled catalog "${id}" doesn't match the Catalog schema: ${detail}`);
  }

  const targetDir = join(catalogDir, id);
  const tmpDir = join(catalogDir, `.tmp-${id}-${randomUUID()}`);
  try {
    for (const file of files) {
      const dest = join(tmpDir, file.path);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, file.bytes);
    }
    await rm(targetDir, { recursive: true, force: true });
    await rename(tmpDir, targetDir);
  } catch (error) {
    await rm(tmpDir, { recursive: true, force: true });
    return err(`catalog-gen: failed writing catalog "${id}": ${errorMessage(error)}`);
  }

  const manifest = await updateManifest(
    catalogDir,
    { id, tag: catalog.lattice.tag, commit: catalog.lattice.commit, hash: catalog.hash, path: `${id}/index.json` },
    opts,
  );
  return ok({ catalog, dir: targetDir, manifest });
}
