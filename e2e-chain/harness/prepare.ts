/**
 * A node ready for the v1 recipes: CreateX and Multicall3 etched (a local node; a Sepolia fork has the real ones),
 * the stand-in Safe at SafeDiamondCut's Safe address, and every shared contract the v1 recipes need on either path
 * deployed through Arachnid's proxy with C5c's transactions.
 */
import type { Catalog } from "@lattice-studio/core";
import { neededFor } from "./catalog";
import type { Node } from "./node";
import { PATHS, entropyFor, etchSafe, fixture, v1Recipes } from "./recipes";
import { deployMissing } from "./shared";
import { etchVendored } from "./vendor";

/** Every shared contract the v1 recipes need on either path. */
export function neededByV1(catalog: Catalog): string[] {
  const names = new Set<string>();
  for (const name of v1Recipes(catalog)) {
    for (const path of PATHS) {
      const f = fixture(catalog, name, path, entropyFor(name));
      for (const n of neededFor(catalog, f.recipe, f.analysis.plan, path)) names.add(n);
    }
  }
  return [...names];
}

export async function prepareChain(node: Node, catalog: Catalog, options: { etch: boolean }): Promise<void> {
  if (options.etch) await etchVendored(node);
  await etchSafe(node);
  await deployMissing(node, catalog, neededByV1(catalog), "multicall");
}
