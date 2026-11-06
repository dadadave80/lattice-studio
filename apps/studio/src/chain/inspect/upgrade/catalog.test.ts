import { expect, test } from "bun:test";
import { reconstructUpgrade, type UpgradeOrigin } from "@lattice-studio/core";
import { makeCatalog, makeFacet, makeRecipe } from "@lattice-studio/core/testing";
import { compositionCatalog, facetDisplayName } from "./catalog";

const known = makeFacet({ name: "Token", selectors: ["read()"] });
const catalog = makeCatalog({ facets: [known] });
const diamond = "0x00000000000000000000000000000000000000aa";
const address = "0x00000000000000000000000000000000000000bb";
const foreign = "0x00000000000000000000000000000000000000cc";
const origin: UpgradeOrigin = { chainId: 11155111, address: diamond, block: 123, blockHash: `0x${"12".repeat(32)}`, owner: null,
  facets: [{ facetAddress: address, functionSelectors: [known.selectors[0]!.hex] }, { facetAddress: foreign, functionSelectors: ["0xdeadbeef"] }, { facetAddress: diamond, functionSelectors: ["0xffffffff"] }],
  codehashes: { [address]: known.release.codehash, [foreign]: `0x${"34".repeat(32)}`, [diamond]: `0x${"56".repeat(32)}` },
};

test("known instances get a stable local catalog view and actual address, without mutating the base", () => {
  const recipe = reconstructUpgrade(origin, catalog);
  if (!recipe.ok) throw new Error(recipe.error);
  const before = JSON.stringify(catalog);
  const view = compositionCatalog(recipe.value, catalog);
  const id = `onchain:${address}`;
  expect(view?.facets.find((facet) => facet.name === id)?.release.address.toLowerCase()).toBe(address);
  expect(facetDisplayName(recipe.value, id)).toBe("Token");
  expect(facetDisplayName(recipe.value, `onchain:${foreign}`)).toBe("Foreign facet");
  expect(facetDisplayName(recipe.value, `onchain:${diamond}`)).toBe("Diamond itself");
  expect(view?.facets.some((facet) => facet.name === `onchain:${foreign}`)).toBe(false);
  expect(compositionCatalog(recipe.value, catalog)).toBe(view);
  expect(JSON.stringify(catalog)).toBe(before);
});

test("fresh compositions retain exact base identity; unmatched pins never earn alias metadata", () => {
  expect(compositionCatalog(makeRecipe({}, catalog), catalog)).toBe(catalog);
  const recipe = reconstructUpgrade(origin, catalog);
  if (!recipe.ok) throw new Error(recipe.error);
  expect(compositionCatalog({ ...recipe.value, catalog: { ...recipe.value.catalog, hash: `0x${"aa".repeat(32)}` } }, catalog)).toBeNull();
});
