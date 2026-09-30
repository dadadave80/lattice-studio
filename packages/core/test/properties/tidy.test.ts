/**
 * Tidy never overlaps cards (spec L479, L932), on sheets from the real recipe generator: catalog facets with
 * their real selector counts, real collisions from the analysis (contested rows make cards taller), expanded
 * cards and either pin side. C9's own properties use synthetic sheets; these use what a person can build.
 */
import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { layoutSizes } from "../../../tokens/dist/tokens";
import { analyze, cardSize, contestedSelectors, isCoreFacet, tidy, type Analysis, type Catalog, type Layout, type LayoutMetrics, type Rect } from "../../src";
import { checkProperty, overlappingPairs, projectArb, propertyCatalogs } from "../../src/testing";

const catalogs = propertyCatalogs();
const metrics: LayoutMetrics = layoutSizes;
const ctx = { known: [], unconfirmed: [] };

/** Each card's rectangle, sized the way the canvas sizes it. */
function rects(layout: Layout, catalog: Catalog, analysis: Analysis): Record<string, Rect> {
  const out: Record<string, Rect> = {};
  for (const [name, entry] of Object.entries(layout)) {
    const facet = catalog.facets.find((f) => f.name === name);
    if (facet === undefined) throw new Error(`${name} isn't in the catalog`);
    const size = cardSize(facet, { metrics, expanded: entry.expanded === true, pins: entry.pins, compact: false, contested: contestedSelectors(analysis, name) });
    out[name] = { x: entry.x, y: entry.y, width: size.width, height: size.height };
  }
  return out;
}

for (const catalog of catalogs) {
  describe(`tidy on catalog ${catalog.lattice.tag}`, () => {
    test("tidy places every card, keeps pins and expanded flags, and never overlaps two cards", () => {
      checkProperty(
        `${catalog.lattice.tag}: tidy never overlaps`,
        fc.property(projectArb(catalog, { maxFacets: 30 }), (project) => {
          const analysis = analyze(project.recipe, catalog, ctx);
          const layout = tidy(project, catalog, analysis, metrics);
          // One card per placed facet; the core (always in the recipe) is never a card.
          expect(Object.keys(layout).sort()).toEqual([...new Set(project.recipe.facets)].filter((name) => !isCoreFacet(name)).sort());
          for (const [name, entry] of Object.entries(layout)) {
            expect([name, entry.pins, entry.expanded]).toEqual([name, project.layout[name]?.pins, project.layout[name]?.expanded]);
            expect(Number.isFinite(entry.x) && Number.isFinite(entry.y)).toBe(true);
          }
          expect(overlappingPairs(rects(layout, catalog, analysis))).toEqual([]);
          expect(tidy({ ...project, layout }, catalog, analysis, metrics)).toEqual(layout);
        }),
      );
    });

    test("tidying a selection never lands a selected card on another card", () => {
      checkProperty(
        `${catalog.lattice.tag}: tidy selection never overlaps`,
        fc.property(
          projectArb(catalog, { maxFacets: 30 }).chain((project) => fc.tuple(fc.constant(project), fc.subarray(Object.keys(project.layout)))),
          ([project, selection]) => {
            const analysis = analyze(project.recipe, catalog, ctx);
            // Start from a tidy sheet, so the cards left alone don't overlap each other already.
            const start = { ...project, layout: tidy(project, catalog, analysis, metrics) };
            const layout = tidy(start, catalog, analysis, metrics, selection);
            const all = rects(layout, catalog, analysis);
            const chosen = new Set(selection);
            const bad = overlappingPairs(all).filter((pair) => pair.split("/").some((name) => chosen.has(name)));
            expect(bad).toEqual([]);
            for (const name of Object.keys(layout)) if (!chosen.has(name)) expect(layout[name]).toEqual(start.layout[name]);
          },
        ),
      );
    });
  });
}
