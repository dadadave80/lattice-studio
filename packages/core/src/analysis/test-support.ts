/** Fixture helpers for C2's tests (routing, analysis, sel and sem checks); not exported from the barrel. */
import type { Catalog } from "../model/catalog";
import type { Hex4 } from "../model/hex";
import type { Recipe } from "../model/recipe";
import { loadFixtureCatalog, makeRecipe, recipeOf } from "../testing";

const loaded = loadFixtureCatalog();

/** K3's fixture catalog (Lattice at the pin), or null when it can't load. */
export const fixture: Catalog | null = loaded.ok ? loaded.value : null;

/** Why the fixture didn't load, for a skipped test's name. */
export const fixtureError: string = loaded.ok ? "" : loaded.error;

/** The fixture catalog; throws when it didn't load (call it only inside tests skipped on `fixture === null`). */
export function catalog(): Catalog {
  if (fixture === null) throw new Error(fixtureError);
  return fixture;
}

/** A copy of a template's recipe as the script builds it (owners, exclusions and init included). */
export function template(name: string): Recipe {
  const found = catalog().recipes.find((r) => r.name === name);
  if (found === undefined) throw new Error(`No template ${name} in the fixture catalog`);
  return structuredClone(recipeOf(found));
}

/** A bare recipe placing `facets` on the fixture catalog. */
export function sheet(facets: string[], extra: Partial<Recipe> = {}): Recipe {
  return makeRecipe({ facets, ...extra }, catalog());
}

/** The selector `signature` has on the fixture catalog. */
export function selectorOf(signature: string): Hex4 {
  for (const facet of catalog().facets) {
    const found = facet.selectors.find((s) => s.signature === signature);
    if (found !== undefined) return found.hex;
  }
  throw new Error(`No fixture facet exports ${signature}`);
}

/** Named selectors used across the tests. */
export const S = {
  sendMessage: "0xcdfe7f5c",
  supportsAttribute: "0xdc680a0f",
  transfer: "0xa9059cbb",
  transferFrom: "0x23b872dd",
  deposit: "0x6e553f65",
  mint: "0x94bf804d",
  withdraw: "0xb460af94",
  redeem: "0xba087652",
  castVoteBySig: "0x8ff262e3",
  totalAssets: "0x01e1d114",
  decimals: "0x313ce567",
  delegate: "0x5c19a95c",
  delegateBySig: "0xc3cda520",
  name: "0x06fdde03",
  clock: "0x91ddadf4",
  CLOCK_MODE: "0x4bf5d7e9",
  receive: "0x00000000",
  exportSelectors: "0x0ef22643",
  diamondCut: "0x1f931c1c",
} as const satisfies Record<string, Hex4>;
