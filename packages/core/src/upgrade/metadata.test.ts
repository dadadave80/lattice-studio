import { expect, test } from "bun:test";
import { makeCatalog, makeFacet, makeRecipe } from "../testing/builders";
import type { Recipe } from "../model/recipe";
import { upgradeFacetMetadata } from "./metadata";

const facet = makeFacet({ name: "Token" });
const catalog = makeCatalog({ facets: [facet] });
const address = "0x00000000000000000000000000000000000000bb";
const id = `onchain:${address}`;
const recipe: Recipe = { ...makeRecipe({}, catalog), mode: "upgrade", facets: [id], facetInstances: { [id]: { kind: "known", address, codehash: facet.release.codehash, catalogFacet: facet.name, extraSelectors: [] } } };

test("ordinary lookup retains identity; known instance returns a new actual-address view", () => {
  const before = JSON.stringify(catalog);
  expect(upgradeFacetMetadata(recipe, catalog, "Token")).toBe(facet);
  const metadata = upgradeFacetMetadata(recipe, catalog, id);
  expect(metadata?.name).toBe(id);
  expect(metadata?.release.address.toLowerCase()).toBe(address);
  expect(metadata).not.toBe(facet);
  expect(metadata?.release).not.toBe(facet.release);
  expect(JSON.stringify(catalog)).toBe(before);
});

test("requires upgrade mode, canonical instance id, pinned catalog and exact runtime hash", () => {
  expect(upgradeFacetMetadata(makeRecipe({}, catalog), catalog, id)).toBeUndefined();
  expect(upgradeFacetMetadata({ ...recipe, catalog: { ...recipe.catalog, hash: `0x${"ab".repeat(32)}` } }, catalog, id)).toBeUndefined();
  expect(upgradeFacetMetadata({ ...recipe, facetInstances: { [id]: { kind: "known", address, catalogFacet: "Token", extraSelectors: [], codehash: `0x${"ab".repeat(32)}` } } }, catalog, id)).toBeUndefined();
  const wrongId = `onchain:${address.toUpperCase().replace("0X", "0x")}`;
  expect(upgradeFacetMetadata({ ...recipe, facetInstances: { [wrongId]: recipe.facetInstances![id]! } }, catalog, wrongId)).toBeUndefined();
});

test.each(["foreign", "self"] as const)("%s instances never earn fake catalog metadata", (kind) => {
  expect(upgradeFacetMetadata({ ...recipe, facetInstances: { [id]: { kind, address, codehash: facet.release.codehash, selectors: ["0x12345678"] } } }, catalog, id)).toBeUndefined();
});
