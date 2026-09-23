import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { layoutSizes } from "../../../tokens/dist/tokens";
import type { Analysis } from "../model/analysis";
import type { Catalog } from "../model/catalog";
import type { Layout, LayoutMetrics, Point, Rect, Sizes, Trace } from "../model/layout";
import { makeCatalog, makeProject, makeRecipe } from "../testing/builders";
import { sel } from "../testing/ids";
import { clearOf } from "./geometry";
import { collisions, contestedByFacet } from "./rows";
import { cardSize } from "./size";
import { analysisWith, buildSheet, facetWith, type SheetSpec } from "./testkit";
import { tidy } from "./tidy";
import { routeTraces } from "./traces";

const metrics: LayoutMetrics = layoutSizes;

function sizesOf(layout: Layout, catalog: Catalog, analysis: Analysis, compact = false): Sizes {
  const contested = contestedByFacet(collisions(analysis));
  const out: Sizes = {};
  for (const [name, e] of Object.entries(layout)) {
    const facet = catalog.facets.find((f) => f.name === name);
    if (facet) out[name] = cardSize(facet, { metrics, expanded: e.expanded === true, pins: e.pins, compact, contested: contested.get(name) ?? [] });
  }
  return out;
}

function route(catalog: Catalog, layout: Layout, analysis: Analysis = analysisWith(), compact = false): Trace[] {
  const recipe = makeRecipe({ facets: catalog.facets.map((f) => f.name).filter((n) => layout[n]) }, catalog);
  return routeTraces({ layout, sizes: sizesOf(layout, catalog, analysis, compact), recipe, catalog, analysis, metrics });
}

function orthogonal(points: readonly Point[]): boolean {
  for (let i = 1; i < points.length; i++) {
    const p = points[i - 1];
    const q = points[i];
    if (!p || !q || (p.x !== q.x && p.y !== q.y)) return false;
  }
  return points.length >= 2;
}

describe("dependency traces", () => {
  const catalog = makeCatalog({
    facets: [facetWith("Dep", 3, 1, [], [["Prov", "Alt"]]), facetWith("Prov", 2, 10), facetWith("Alt", 2, 20)],
  });

  test("one trace per met requirement, to the first placed option, labelled at the midpoint", () => {
    const layout: Layout = { Prov: { x: 96, y: 96, pins: "right" }, Alt: { x: 96, y: 400, pins: "right" }, Dep: { x: 400, y: 96, pins: "right" } };
    const [trace, ...rest] = route(catalog, layout);
    expect(rest).toEqual([]);
    expect(trace).toEqual({
      id: "needs:Dep:Prov",
      kind: "dependency",
      from: "Dep",
      to: "Prov",
      // Header centers, facing sides: Dep's left edge to Prov's right edge.
      points: [{ x: 400, y: 120 }, { x: 328, y: 120 }],
      mid: { x: 364, y: 120 },
      label: "needs Prov",
    });
  });

  test("falls back to the next placed option; none placed, no trace", () => {
    const withAlt: Layout = { Alt: { x: 96, y: 400, pins: "right" }, Dep: { x: 400, y: 96, pins: "right" } };
    expect(route(catalog, withAlt).map((t) => t.label)).toEqual(["needs Alt"]);
    expect(route(catalog, { Dep: { x: 0, y: 0, pins: "right" } })).toEqual([]);
  });

  test("paths are orthogonal and detour around a card in the way", () => {
    const c = makeCatalog({ facets: [facetWith("A", 2, 1), facetWith("Mid", 2, 10), facetWith("B", 2, 20, [], [["A"]])] });
    const layout: Layout = { A: { x: 0, y: 0, pins: "right" }, Mid: { x: 400, y: 0, pins: "right" }, B: { x: 800, y: 0, pins: "right" } };
    const [trace] = route(c, layout);
    expect(trace).toBeDefined();
    expect(orthogonal(trace?.points ?? [])).toBe(true);
    const mid: Rect = { x: 400, y: 0, width: 232, height: 132 };
    expect(clearOf(trace?.points ?? [], [mid])).toBe(true);
  });
});

describe("ties", () => {
  const shared = sel(9000);
  const catalog = makeCatalog({
    facets: [facetWith("A", 12, 1, [shared, sel(9001)]), facetWith("B", 12, 100, [shared, sel(9001)]), facetWith("C", 2, 200, [shared])],
  });
  const layout: Layout = { A: { x: 96, y: 96, pins: "right" }, B: { x: 704, y: 96, pins: "left" } };

  test("a tie joins the contested pin rows, even rows a collapsed card would hide", () => {
    const analysis = analysisWith([{ selector: shared, contenders: ["A", "B"] }]);
    const [tie, ...rest] = route(catalog, layout, analysis);
    expect(rest).toEqual([]);
    // The 13th selector shows as row 5 (after 5 uncontested rows): 96 + 48 + 8 + 5·20 + 10 = 262.
    expect(tie).toEqual({
      id: `tie:${shared}:A+B`,
      kind: "tie",
      from: "A",
      to: "B",
      points: [{ x: 328, y: 262 }, { x: 704, y: 262 }],
      mid: { x: 516, y: 262 },
      selector: shared,
    });
  });

  test("one tie per contested selector, each in its own lane", () => {
    const analysis = analysisWith([
      { selector: shared, contenders: ["A", "B"] },
      { selector: sel(9001), contenders: ["A", "B"] },
    ]);
    const ties = route(catalog, { A: { x: 96, y: 96, pins: "right" }, B: { x: 704, y: 400, pins: "left" } }, analysis);
    expect(ties.map((t) => t.id)).toEqual([`tie:${shared}:A+B`, `tie:${sel(9001)}:A+B`]);
    const verticals = ties.map((t) => t.points.find((p, i) => i > 0 && t.points[i - 1]?.x === p.x)?.x);
    expect(verticals[0]).not.toBe(verticals[1]);
  });

  test("three contenders chain in catalog order", () => {
    const analysis = analysisWith([{ selector: shared, contenders: ["A", "B", "C"] }]);
    const ties = route(catalog, { ...layout, C: { x: 96, y: 600, pins: "right" } }, analysis);
    expect(ties.map((t) => `${t.from}+${t.to}`)).toEqual(["A+B", "B+C"]);
  });

  test("a resolved collision draws no tie", () => {
    expect(route(catalog, layout, analysisWith())).toEqual([]);
  });

  test("compact cards anchor ties on their tick strip", () => {
    const analysis = analysisWith([{ selector: shared, contenders: ["A", "B"] }]);
    const [tie] = route(catalog, layout, analysis, true);
    // Compact height 68: the anchor clamps to 96 + 68 − 10.
    expect(tie?.points[0]).toEqual({ x: 328, y: 154 });
  });
});

describe("trace properties", () => {
  const sheetArb: fc.Arbitrary<SheetSpec> = fc.integer({ min: 1, max: 30 }).chain((n) =>
    fc.record({
      counts: fc.array(fc.integer({ min: 1, max: 16 }), { minLength: n, maxLength: n }),
      requires: fc.array(fc.array(fc.nat({ max: n - 1 }), { maxLength: 2 }), { minLength: n, maxLength: n }),
      shared: fc.array(fc.array(fc.nat({ max: n - 1 }), { minLength: 2, maxLength: 3 }), { maxLength: 6 }),
    }),
  );

  test("on a tidied sheet: orthogonal paths, unique ids, same output for the same input", () => {
    fc.assert(
      fc.property(sheetArb, (spec) => {
        const { catalog, names, collisions: list } = buildSheet(spec);
        const analysis = analysisWith(list);
        const project = makeProject({ recipe: makeRecipe({ facets: names }, catalog) });
        const layout = tidy(project, catalog, analysis, metrics);
        const traces = route(catalog, layout, analysis);
        for (const t of traces) expect(orthogonal(t.points)).toBe(true);
        expect(new Set(traces.map((t) => t.id)).size).toBe(traces.length);
        expect(route(catalog, layout, analysis)).toEqual(traces);
      }),
      { numRuns: 60 },
    );
  });
});
