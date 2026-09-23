/**
 * Order independence (spec L283, L300, L932): the recipe hash and the whole analysis don't depend on the order
 * facets were placed in, on the order of `owners` keys or `exclude`, or on hex case; placing the same facets
 * one by one through C11's `placeFacet`, in any order, gives the same recipe.
 */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { analyze, CHECKS, normalizeRecipe, placeFacet, recipeHash, type Catalog, type Project } from "../../src";
import { checkProperty, makeProject, makeRecipe, permutation, presentationArb, propertyCatalogs, recipeArb } from "../../src/testing";

const catalogs = propertyCatalogs();
const ctx = { known: [], unconfirmed: [] };
/** Injected checks bypass `analyze`'s memo, so each side is computed from scratch, not read back from a cache. */
const fresh = { checks: CHECKS.map((check) => check.run) };

function placedOneByOne(catalog: Catalog, names: readonly string[]): Project {
  let project = makeProject({ recipe: makeRecipe({}, catalog) });
  names.forEach((name, i) => {
    const result = placeFacet(project, catalog, name, { x: i * 320, y: 0 });
    expect(result.summary.length).toBeGreaterThan(0);
    project = result.project;
  });
  return project;
}

for (const catalog of catalogs) {
  describe(`order on catalog ${catalog.lattice.tag}`, () => {
    test("the recipe hash doesn't depend on placement order, key order or hex case", () => {
      checkProperty(
        `${catalog.lattice.tag}: hash ignores presentation`,
        fc.property(
          recipeArb(catalog).chain((recipe) => fc.tuple(fc.constant(recipe), presentationArb(recipe))),
          ([recipe, presented]) => {
            expect(recipeHash(presented, catalog)).toBe(recipeHash(recipe, catalog));
            expect(recipeHash(normalizeRecipe(presented, catalog))).toBe(recipeHash(recipe, catalog));
            expect(normalizeRecipe(presented, catalog)).toEqual(normalizeRecipe(recipe, catalog));
          },
        ),
      );
    });

    test("the analysis doesn't depend on placement order, key order or hex case", () => {
      checkProperty(
        `${catalog.lattice.tag}: analysis ignores presentation`,
        fc.property(
          recipeArb(catalog).chain((recipe) => fc.tuple(fc.constant(recipe), presentationArb(recipe))),
          ([recipe, presented]) => {
            const a = analyze(recipe, catalog, ctx, fresh);
            const b = analyze(presented, catalog, ctx, fresh);
            expect(b).not.toBe(a);
            expect(b).toEqual(a);
            // The memoized path agrees with the fresh one.
            expect(analyze(presented, catalog, ctx)).toEqual(a);
          },
        ),
      );
    });

    test("placing the same facets one by one, in any order, gives the same recipe and analysis", () => {
      const names = catalog.facets.map((facet) => facet.name);
      checkProperty(
        `${catalog.lattice.tag}: placement order`,
        fc.property(
          fc
            .shuffledSubarray(names, { minLength: 1, maxLength: Math.min(10, names.length) })
            .chain((picked) => fc.tuple(fc.constant(picked), permutation(picked))),
          ([first, second]) => {
            const a = placedOneByOne(catalog, first).recipe;
            const b = placedOneByOne(catalog, second).recipe;
            expect(b).toEqual(a);
            expect(recipeHash(b, catalog)).toBe(recipeHash(a, catalog));
            expect(analyze(b, catalog, ctx, fresh)).toEqual(analyze(a, catalog, ctx, fresh));
          },
        ),
      );
    });
  });
}
