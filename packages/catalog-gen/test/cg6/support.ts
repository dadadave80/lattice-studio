/**
 * What the CG6 tests check the real recipe overlay against: the fixture catalog's 105 facets (names, selectors,
 * signatures and families, which K3 checks against Lattice's source), every init spec name the overlay knows
 * (CG5) with the fixture's params where it has them, and the golden routing GT1 recorded from the scripts.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Catalog, Hex4 } from "@lattice-studio/core";
import { loadOverlay } from "../../src/overlay";
import type { RecipeFacts, SourceReader } from "../../src/recipes";

export const REPO_ROOT = join(import.meta.dir, "..", "..", "..", "..");

export function fixtureCatalog(): Catalog {
  return JSON.parse(readFileSync(join(REPO_ROOT, "fixtures", "catalog", "fixture", "index.json"), "utf8")) as Catalog;
}

/** `LATTICE_DIR`, else the repo's `lattice/`, when it's a checkout. */
export function latticeDir(): string | null {
  for (const dir of [process.env["LATTICE_DIR"], join(REPO_ROOT, "lattice")]) {
    if (dir && existsSync(join(dir, "script", "lib", "FacetInventory.sol"))) return dir;
  }
  return null;
}

/** Reads checkout files as lines. */
export function readerFor(dir: string): SourceReader {
  return (path) => {
    const file = join(dir, path);
    return existsSync(file) ? readFileSync(file, "utf8").split("\n") : undefined;
  };
}

/** Every `*.s.sol` under `script/base` in the checkout, relative to it, sorted. */
export function deployScripts(dir: string): string[] {
  const out: string[] = [];
  const walk = (rel: string) => {
    for (const entry of readdirSync(join(dir, rel), { withFileTypes: true })) {
      const path = `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".s.sol")) out.push(path);
    }
  };
  walk("script/base");
  return out.sort();
}

/** The facts `buildTemplates` needs, from the fixture catalog and the real init overlay. */
export async function recipeFacts(catalog: Catalog = fixtureCatalog()): Promise<RecipeFacts> {
  const overlay = await loadOverlay();
  if (!overlay.ok) throw new Error(overlay.error.map((i) => `${i.file} ${i.path}: ${i.message}`).join("\n"));
  const withParams = new Map(catalog.inits.map((i) => [i.name, i.params]));
  const names = [...new Set([...Object.keys(overlay.value.inits), ...withParams.keys()])].sort();
  return {
    tag: catalog.lattice.tag,
    facets: catalog.facets.map((f) => ({
      name: f.name,
      selectors: f.selectors,
      ...(f.family === undefined ? {} : { family: f.family }),
    })),
    inits: names.map((name) => {
      const params = withParams.get(name);
      return params === undefined ? { name } : { name, params };
    }),
  };
}

/** One recipe's expected routing, as GT1 recorded it from the script (`golden/expected/<Name>.routing.json`). */
export type GoldenRouting = {
  recipe: string;
  script: string;
  buildCuts: string;
  facets: string[];
  routing: Record<Hex4, string>;
  signatures: Record<Hex4, string>;
  init: { kind: "MultiInit" | "direct" | "none"; steps: { init: string; selector: Hex4; signature: string }[] };
};

export function goldenRouting(name: string): GoldenRouting {
  return JSON.parse(readFileSync(join(REPO_ROOT, "golden", "expected", `${name}.routing.json`), "utf8")) as GoldenRouting;
}

export const V1 = ["GovernedVault", "ERC20", "SafeDiamondCut"] as const;
