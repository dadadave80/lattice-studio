/**
 * The real catalog the e2e build serves (`catalog/manifest.json`'s default, CG8), read in Node for seeding and for
 * the Anvil kit: the index, each shared contract's creation code (checked against its init code hash), and which
 * shared contracts a recipe needs.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { keccak256, type Hex } from "viem";
import {
  analyze, planInit, templateList, type Catalog, type CreationCode, type Recipe, type SharedContract,
} from "@lattice-studio/core";
import { loadBuiltCatalog } from "@lattice-studio/core/testing";
import { repoRoot } from "./env.ts";

let cached: { catalog: Catalog; dir: string } | undefined;

/** The built catalog and the folder its files are relative to. Throws while it isn't built (`bun run catalog`). */
export function builtCatalog(): { catalog: Catalog; dir: string } {
  if (cached) return cached;
  const loaded = loadBuiltCatalog();
  if (!loaded.ok) throw new Error(`The e2e kit needs the built catalog: ${loaded.error}`);
  const manifest = JSON.parse(readFileSync(join(repoRoot, "catalog", "manifest.json"), "utf8")) as {
    default: string;
    catalogs: { id: string; path: string }[];
  };
  const entry = manifest.catalogs.find((c) => c.id === manifest.default);
  if (!entry) throw new Error("catalog/manifest.json names no default catalog.");
  cached = { catalog: loaded.value, dir: dirname(join(repoRoot, "catalog", entry.path)) };
  return cached;
}

/** The catalog alone. */
export function catalog(): Catalog {
  return builtCatalog().catalog;
}

/** The recipes v1 loads (templates on the plain Lattice proxy), in catalog order. */
export function v1Recipes(from: Catalog = catalog()): string[] {
  return templateList(from).filter((t) => t.loadable).map((t) => t.name);
}

/** Every shared contract by the name `buildMissingDeploys` resolves it under (as Q5's harness lists them). */
export function sharedContracts(from: Catalog = catalog()): { name: string; release: SharedContract }[] {
  const out: { name: string; release: SharedContract }[] = [
    { name: "LatticeRegistry", release: from.registry },
    { name: "LatticeFactory", release: from.factory },
  ];
  for (const library of from.libraries ?? []) out.push({ name: library.name, release: library.release });
  for (const facet of from.facets) out.push({ name: facet.name, release: facet.release });
  const seen = new Set(out.map((item) => item.release.address.toLowerCase()));
  for (const init of from.inits) {
    if (!init.release || seen.has(init.release.address.toLowerCase())) continue;
    seen.add(init.release.address.toLowerCase());
    out.push({ name: init.name, release: init.release });
  }
  return out;
}

/** Creation code for `names` (and what they depend on), each checked against its release's init code hash. */
export function creationCode(names: readonly string[]): CreationCode {
  const { catalog: from, dir } = builtCatalog();
  const all = sharedContracts(from);
  const code: CreationCode = {};
  for (const name of names) {
    const item = all.find((entry) => entry.name === name);
    if (!item) throw new Error(`${name} isn't a shared contract in the catalog.`);
    const bytes = readFileSync(join(dir, item.release.creationCode.path), "utf8").trim() as Hex;
    if (keccak256(bytes) !== item.release.initCodeHash.toLowerCase()) {
      throw new Error(`${name}'s creation code doesn't hash to its initCodeHash; refusing to deploy it.`);
    }
    code[name] = bytes;
  }
  return code;
}

/**
 * The shared contracts one recipe needs on either deploy path: its planned facets, the init contracts its steps
 * call, MultiInit with two or more steps, and LatticeRegistry and LatticeFactory (the factory path).
 */
export function neededFor(recipe: Recipe, from: Catalog = catalog()): string[] {
  const names = new Set<string>(["LatticeRegistry", "LatticeFactory"]);
  for (const entry of analyze(recipe, from).plan) names.add(entry.facet);
  const steps = planInit(recipe, from).steps;
  const shared = sharedContracts(from);
  for (const step of steps) {
    const release = from.inits.find((init) => init.name === step.spec)?.release;
    if (!release) continue;
    // Entry points of one init contract share a release; `sharedContracts` lists it under the first one's name.
    const listed = shared.find((item) => item.release.address.toLowerCase() === release.address.toLowerCase());
    if (listed) names.add(listed.name);
  }
  if (steps.length > 1) names.add("MultiInit");
  return [...names];
}
