/**
 * The real catalog `bun run catalog` built (catalog/manifest.json's default), with the files core can't read for
 * itself: creation code by shared-contract name and the ABI shards `decodeRevert` looks errors up in.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { keccak256, type Hex } from "viem";
import {
  planInit, validateFacetDetail, type Catalog, type CreationCode, type FacetDetail, type PlanEntry, type Recipe,
  type SharedContract,
} from "@lattice-studio/core";
import { loadBuiltCatalog } from "@lattice-studio/core/testing";
import { ROOT } from "./env";

function manifestPath(): string {
  const manifest = JSON.parse(readFileSync(join(ROOT, "catalog/manifest.json"), "utf8")) as {
    default: string;
    catalogs: { id: string; path: string }[];
  };
  const entry = manifest.catalogs.find((c) => c.id === manifest.default);
  if (entry === undefined) throw new Error("catalog/manifest.json names no default catalog");
  return join(ROOT, "catalog", entry.path, "..");
}

let cached: { catalog: Catalog; dir: string } | undefined;

/** The built catalog and its directory. Throws while it isn't built (CG8 builds it). */
export function builtCatalog(): { catalog: Catalog; dir: string } {
  if (cached !== undefined) return cached;
  const loaded = loadBuiltCatalog();
  if (!loaded.ok) throw new Error(loaded.error);
  cached = { catalog: loaded.value, dir: manifestPath() };
  return cached;
}

/** Every shared contract in the catalog by the name `buildMissingDeploys` resolves it under. */
export function sharedContracts(catalog: Catalog): { name: string; release: SharedContract }[] {
  const out: { name: string; release: SharedContract }[] = [
    { name: "LatticeRegistry", release: catalog.registry },
    { name: "LatticeFactory", release: catalog.factory },
  ];
  for (const library of catalog.libraries ?? []) out.push({ name: library.name, release: library.release });
  for (const facet of catalog.facets) out.push({ name: facet.name, release: facet.release });
  const seen = new Set(out.map((item) => item.release.address.toLowerCase()));
  for (const init of catalog.inits) {
    if (init.release === undefined || seen.has(init.release.address.toLowerCase())) continue;
    seen.add(init.release.address.toLowerCase());
    out.push({ name: init.name, release: init.release });
  }
  return out;
}

function readHex(dir: string, path: string): Hex {
  const file = join(dir, path);
  if (!existsSync(file)) throw new Error(`${file} doesn't exist`);
  return readFileSync(file, "utf8").trim() as Hex;
}

/** Creation code for `names`, each checked against its release's init code hash. */
export function creationCode(names: readonly string[]): CreationCode {
  const { catalog, dir } = builtCatalog();
  const all = sharedContracts(catalog);
  const code: CreationCode = {};
  for (const name of names) {
    const item = all.find((entry) => entry.name === name) ?? all.find((entry) => catalog.inits.some((i) => i.contract === name && i.name === entry.name));
    if (item === undefined) throw new Error(`${name} isn't a shared contract`);
    const bytes = readHex(dir, item.release.creationCode.path);
    if (keccak256(bytes) !== item.release.initCodeHash.toLowerCase()) throw new Error(`${name}'s creation code doesn't hash to its initCodeHash`);
    code[name] = bytes;
  }
  return code;
}

/** The `Lattice` proxy's creation code (the CreateX path's initCode). */
export function proxyCreationCode(): Hex {
  const { catalog, dir } = builtCatalog();
  const bytes = readHex(dir, catalog.proxy.creationCode.path);
  if (keccak256(bytes) !== catalog.proxy.initCodeHash.toLowerCase()) throw new Error("Lattice.creation.hex doesn't hash to catalog.proxy.initCodeHash");
  return bytes;
}

/** Every ABI shard the catalog ships (facets, inits, Lattice, LatticeFactory, LatticeRegistry), by name. */
export function revertDetails(): Record<string, FacetDetail> {
  const { catalog, dir } = builtCatalog();
  const refs: { name: string; path: string }[] = [];
  const add = (name: string, path: string | undefined): void => {
    if (path !== undefined && !refs.some((r) => r.name === name)) refs.push({ name, path });
  };
  add("Lattice", catalog.proxy.detail?.path);
  add("LatticeFactory", catalog.factory.detail?.path);
  add("LatticeRegistry", catalog.registry.detail?.path);
  for (const facet of catalog.facets) add(facet.name, facet.detail.path);
  for (const init of catalog.inits) add(init.contract, init.release?.detail?.path);
  const details: Record<string, FacetDetail> = {};
  for (const ref of refs) {
    const parsed = validateFacetDetail(JSON.parse(readFileSync(join(dir, ref.path), "utf8")));
    if (!parsed.ok) throw new Error(`${ref.path}: ${JSON.stringify(parsed.error).slice(0, 300)}`);
    details[ref.name] = parsed.value;
  }
  return details;
}

/**
 * The shared contracts one deploy needs, by the name `sharedContracts` lists them under: every planned facet, the
 * init contracts its steps call, MultiInit when there are two or more steps, and, on the factory path,
 * LatticeRegistry and LatticeFactory. Two specs of one contract share a release (DiamondIntrospectionInit's
 * `initImmutable` and `initUpgradeable`), so a step names the contract by its release's first spec.
 */
export function neededFor(catalog: Catalog, recipe: Recipe, plan: readonly PlanEntry[], path: "factory" | "createx"): string[] {
  const names = new Set<string>(path === "factory" ? ["LatticeRegistry", "LatticeFactory"] : []);
  for (const entry of plan) names.add(entry.facet);
  const byAddress = new Map(sharedContracts(catalog).map((item) => [item.release.address.toLowerCase(), item.name]));
  const steps = planInit(recipe, catalog).steps;
  for (const step of steps) {
    const spec = catalog.inits.find((init) => init.name === step.spec);
    if (spec?.release !== undefined) names.add(byAddress.get(spec.release.address.toLowerCase()) ?? spec.name);
  }
  if (steps.length > 1) names.add("MultiInit");
  return [...names];
}
