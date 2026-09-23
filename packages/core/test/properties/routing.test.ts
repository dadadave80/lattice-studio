/**
 * Routing properties (spec L302-L303, L932): at most one owner per selector; the plan's Adds, applied to an
 * empty diamond, give the analysis routing; seams always route to an allowed facet; and every selector a
 * template's exclusion lists hand to one facet (its `owners`, spec L284) is a seam or a default owner.
 */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { analyze, comparePlan, computeRouting, type Address, type Catalog, type Hex4, type LoupeFacet, type Recipe } from "../../src";
import { checkProperty, contendersOf, presentationArb, propertyCatalogs, recipeArb } from "../../src/testing";

const catalogs = propertyCatalogs();
const ctx = { known: [], unconfirmed: [] };

test("the fixture catalog is there to generate from", () => {
  expect(catalogs.length).toBeGreaterThanOrEqual(1);
});

function releaseOf(catalog: Catalog, facet: string): string | undefined {
  return catalog.facets.find((f) => f.name === facet)?.release.address;
}

/** The seam that governs `selector` on this sheet: the first in catalog order whose `when` facets are all placed. */
function activeSeam(catalog: Catalog, placed: ReadonlySet<string>, selector: Hex4) {
  return catalog.seams.find((seam) => seam.selector.toLowerCase() === selector && seam.when.every((name) => placed.has(name)));
}

for (const catalog of catalogs) {
  describe(`routing on catalog ${catalog.lattice.tag}`, () => {
    test("each selector has at most one owner, a placed facet that exports it, and at most one Add", () => {
      checkProperty(
        `${catalog.lattice.tag}: one owner per selector`,
        fc.property(recipeArb(catalog), (recipe) => {
          const analysis = analyze(recipe, catalog, ctx);
          const contenders = contendersOf(catalog, recipe.facets);
          const excluded = new Set(recipe.exclude.map((s) => s.toLowerCase()));
          expect(Object.keys(analysis.routing).sort()).toEqual([...contenders.keys()].sort());
          for (const [selector, route] of Object.entries(analysis.routing)) {
            expect(route.contenders).toEqual(contenders.get(selector as Hex4) ?? []);
            if (route.owner !== undefined) expect(route.contenders).toContain(route.owner);
            if (excluded.has(selector)) expect(route.owner).toBeUndefined();
          }
          const seen = new Map<string, string>();
          for (const entry of analysis.plan) {
            for (const selector of entry.selectors) {
              expect([selector, seen.get(selector)]).toEqual([selector, undefined]);
              seen.set(selector, entry.facet);
              expect(analysis.routing[selector]?.owner).toBe(entry.facet);
            }
          }
        }),
      );
    });

    test("applying the plan's Adds to an empty diamond yields the analysis routing", () => {
      checkProperty(
        `${catalog.lattice.tag}: plan applied equals routing`,
        fc.property(
          recipeArb(catalog).chain((recipe) => fc.tuple(fc.constant(recipe), fc.nat())),
          ([recipe, rotate]) => {
            const analysis = analyze(recipe, catalog, ctx);
            // The diamond: Lattice's `diamondCut` Add reverts on a selector that is already there.
            const diamond = new Map<Hex4, string>();
            for (const entry of analysis.plan) {
              expect<string>(entry.address).toBe(releaseOf(catalog, entry.facet) ?? "");
              expect(entry.selectors.length).toBeGreaterThan(0);
              for (const selector of entry.selectors) {
                if (diamond.has(selector)) throw new Error(`Add reverts: ${selector} is already cut`);
                diamond.set(selector, entry.address);
              }
            }
            const expected = new Map<Hex4, string>();
            for (const [selector, route] of Object.entries(analysis.routing)) {
              if (route.owner !== undefined) expected.set(selector as Hex4, releaseOf(catalog, route.owner) ?? "");
            }
            expect(Object.fromEntries([...diamond].sort())).toEqual(Object.fromEntries([...expected].sort()));
            // The loupe reads the same diamond back in any facet order (the factory cuts registry entries first).
            const byAddress = new Map<string, Hex4[]>();
            for (const [selector, at] of diamond) byAddress.set(at, [...(byAddress.get(at) ?? []), selector]);
            const loupe: LoupeFacet[] = [...byAddress].map(([facetAddress, functionSelectors]) => ({
              facetAddress: facetAddress as Address,
              functionSelectors: [...functionSelectors].reverse(),
            }));
            const shift = loupe.length === 0 ? 0 : rotate % loupe.length;
            const rotated = [...loupe.slice(shift), ...loupe.slice(0, shift)];
            expect(comparePlan(analysis.plan, rotated).matches).toBe(true);
          },
        ),
      );
    });

    test("seams always route to an allowed facet, whatever the owners say; with none placed, SEM-01 blocks", () => {
      let active = 0;
      let overridden = 0;
      checkProperty(
        `${catalog.lattice.tag}: seams route to an allowed facet`,
        fc.property(recipeArb(catalog), (recipe) => {
          const analysis = analyze(recipe, catalog, ctx);
          const placed = new Set(recipe.facets);
          const excluded = new Set(recipe.exclude.map((s) => s.toLowerCase()));
          const contenders = contendersOf(catalog, recipe.facets);
          const selectors = new Set(catalog.seams.map((seam) => seam.selector.toLowerCase() as Hex4));
          for (const selector of selectors) {
            const seam = activeSeam(catalog, placed, selector);
            if (seam === undefined || excluded.has(selector)) continue;
            active++;
            const allowed = seam.anyOf.filter((name) => contenders.get(selector)?.includes(name) === true);
            const route = analysis.routing[selector];
            const blocker = analysis.problems.find((p) => p.id === `SEM-01:${selector}`);
            if (allowed.length > 0) {
              expect([selector, route?.owner, route?.via]).toEqual([selector, allowed[0], "seam"]);
              const owner = recipe.owners[selector];
              if (owner !== undefined && !seam.anyOf.includes(owner)) {
                overridden++;
                if (contenders.get(selector)?.includes(owner) === true) expect(blocker?.severity).toBe("blocker");
              }
            } else {
              expect([selector, blocker?.severity]).toEqual([selector, "blocker"]);
              if (route?.owner !== undefined) expect(seam.anyOf).not.toContain(route.owner);
            }
          }
        }),
      );
      if (catalog.seams.length > 0) {
        // Not vacuous: the generator reaches active seams, and owners that name a facet outside them.
        expect(active).toBeGreaterThan(50);
        expect(overridden).toBeGreaterThan(5);
      }
    });

    test('every selector a template\'s exclusion lists say "wins" is a seam or a default owner', () => {
      const templates = catalog.recipes.filter((template) => Object.keys(template.recipe.owners).length > 0);
      if (catalog.lattice.tag === "fixture") expect(templates.map((t) => t.name)).toContain("GovernedVault");
      if (templates.length === 0) return;
      checkProperty(
        `${catalog.lattice.tag}: template owners win on their own`,
        fc.property(
          fc.constantFrom(...templates).chain((template) =>
            fc.tuple(
              fc.constant(template),
              fc.subarray(Object.keys(template.recipe.owners) as Hex4[], { minLength: 1 }),
              presentationArb({ ...template.recipe, owners: {} }),
            ),
          ),
          ([template, stripped, presented]) => {
            // Some owners dropped: each dropped selector still goes to the facet the template's script cut it on.
            const kept: Record<Hex4, string> = {};
            for (const [selector, owner] of Object.entries(template.recipe.owners)) {
              if (!stripped.includes(selector as Hex4)) kept[selector as Hex4] = owner;
            }
            const recipe: Recipe = { ...presented, owners: kept };
            const routing = computeRouting(recipe, catalog);
            for (const selector of stripped) {
              const route = routing[selector];
              expect([template.name, selector, route?.owner, route?.via === "seam" || route?.via === "default"]).toEqual([
                template.name,
                selector,
                template.recipe.owners[selector],
                true,
              ]);
            }
          },
        ),
      );
    });
  });
}
