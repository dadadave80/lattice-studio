import { expect, test } from "bun:test";
import { makeCatalog, makeFacet, makeRecipe } from "../testing/builders";
import type { Recipe } from "../model/recipe";
import { projectUpgradeCatalog } from "./projection";
import { resolveUpgrade } from "./resolve";

const address = "0x0000000000000000000000000000000000000011";
const id = `onchain:${address}`;
const catalog = makeCatalog({ facets: [makeFacet({ name: "Known" })] });
const facet = catalog.facets[0]!;
const recipe: Recipe = makeRecipe({ mode: "upgrade", facets: [id], facetInstances: {
  [id]: { kind: "known", address, codehash: facet.release.codehash, catalogFacet: "Known", extraSelectors: [] },
} }, catalog);

test("eager metadata projection agrees with the fully validated resolver without changing the catalog", () => {
  const before = JSON.stringify(catalog);
  expect(projectUpgradeCatalog(recipe, catalog)).toEqual(resolveUpgrade(recipe, catalog));
  expect(JSON.stringify(catalog)).toBe(before);
});

test("metadata projection refuses a forged pin, runtime hash or address identity", () => {
  const instance = recipe.facetInstances![id]!;
  for (const changed of [
    { ...recipe, catalog: { ...recipe.catalog, hash: `0x${"ab".repeat(32)}` as const } },
    { ...recipe, facetInstances: { [id]: { ...instance, codehash: `0x${"ab".repeat(32)}` as const } } },
    { ...recipe, facetInstances: { "onchain:wrong": instance } },
  ]) expect(projectUpgradeCatalog(changed, catalog).ok).toBe(false);
});
