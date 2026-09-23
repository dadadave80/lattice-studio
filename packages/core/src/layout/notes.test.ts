import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { layoutSizes } from "../../../tokens/dist/tokens";
import type { Layout, LayoutMetrics, NoteRequest, Rect, Sizes, Trace } from "../model/layout";
import { makeProject, makeRecipe } from "../testing/builders";
import { sel } from "../testing/ids";
import { overlaps } from "./geometry";
import { placeNotes } from "./notes";
import { collisions, contestedByFacet } from "./rows";
import { cardSize } from "./size";
import { analysisWith, buildSheet, type SheetSpec } from "./testkit";
import { tidy } from "./tidy";
import { routeTraces } from "./traces";

const metrics: LayoutMetrics = layoutSizes;
const W = 232;

function rects(layout: Layout, sizes: Sizes): Rect[] {
  return Object.entries(layout).map(([n, e]) => ({ x: e.x, y: e.y, width: sizes[n]?.width ?? 0, height: sizes[n]?.height ?? 0 }));
}

describe("placeNotes", () => {
  test("a collision note goes right of its tie's midpoint, with a leader from the midpoint", () => {
    const layout: Layout = { A: { x: 96, y: 96, pins: "right" }, B: { x: 1104, y: 96, pins: "left" } };
    const sizes: Sizes = { A: { width: W, height: 252 }, B: { width: W, height: 252 } };
    const tie: Trace = {
      id: "tie:0x00002328:A+B",
      kind: "tie",
      from: "A",
      to: "B",
      points: [{ x: 328, y: 262 }, { x: 1104, y: 262 }],
      mid: { x: 716, y: 262 },
      selector: sel(9000),
    };
    const note: NoteRequest = { id: "SEL-01:0x00002328", size: { width: 200, height: 120 }, facets: ["A", "B"], traces: [tie.id] };
    expect(placeNotes({ layout, sizes, traces: [tie], notes: [note], metrics })).toEqual([
      {
        id: "SEL-01:0x00002328",
        rect: { x: 760, y: 200, width: 200, height: 120 },
        anchor: { x: 716, y: 262 },
        leader: [{ x: 716, y: 262 }, { x: 760, y: 262 }],
      },
    ]);
  });

  test("a card note goes above the card first, its leader from the card's nearest point", () => {
    const layout: Layout = { Dep: { x: 400, y: 96, pins: "right" } };
    const sizes: Sizes = { Dep: { width: W, height: 132 } };
    const [placed] = placeNotes({ layout, sizes, traces: [], notes: [{ id: "DEP-01:Dep+Prov", size: { width: 200, height: 72 }, facets: ["Dep"] }], metrics });
    expect(placed).toEqual({
      id: "DEP-01:Dep+Prov",
      rect: { x: 400, y: 0, width: 200, height: 72 },
      anchor: { x: 500, y: 96 },
      leader: [{ x: 500, y: 96 }, { x: 500, y: 72 }],
    });
  });

  test("with the space above taken, a card note goes on the side away from its pins", () => {
    const layout: Layout = { Dep: { x: 400, y: 96, pins: "right" }, Above: { x: 400, y: -200, pins: "right" } };
    const sizes: Sizes = { Dep: { width: W, height: 132 }, Above: { width: W, height: 280 } };
    const [placed] = placeNotes({ layout, sizes, traces: [], notes: [{ id: "n", size: { width: 200, height: 72 }, facets: ["Dep"] }], metrics });
    expect(placed?.rect).toEqual({ x: 160, y: 96, width: 200, height: 72 });
  });

  test("later notes avoid earlier ones", () => {
    const layout: Layout = { Dep: { x: 400, y: 96, pins: "right" } };
    const sizes: Sizes = { Dep: { width: W, height: 132 } };
    const notes: NoteRequest[] = [
      { id: "a", size: { width: 200, height: 72 }, facets: ["Dep"] },
      { id: "b", size: { width: 200, height: 72 }, facets: ["Dep"] },
    ];
    const [a, b] = placeNotes({ layout, sizes, traces: [], notes, metrics });
    expect(a && b && overlaps(a.rect, b.rect, 8)).toBe(false);
  });

  test("a note with nothing on the sheet goes right of the content, with no leader", () => {
    const layout: Layout = { A: { x: 0, y: 0, pins: "right" } };
    const sizes: Sizes = { A: { width: W, height: 132 } };
    const [placed] = placeNotes({ layout, sizes, traces: [], notes: [{ id: "x", size: { width: 200, height: 80 }, facets: ["Gone"] }], metrics });
    expect(placed).toEqual({ id: "x", rect: { x: 272, y: 0, width: 200, height: 80 }, anchor: { x: 272, y: 40 }, leader: [] });
  });

  test("property: notes never cover a card or each other, leaders end on the note, same output for the same input", () => {
    const sheetArb: fc.Arbitrary<SheetSpec> = fc.integer({ min: 1, max: 40 }).chain((n) =>
      fc.record({
        counts: fc.array(fc.integer({ min: 1, max: 16 }), { minLength: n, maxLength: n }),
        requires: fc.array(fc.array(fc.nat({ max: n - 1 }), { maxLength: 2 }), { minLength: n, maxLength: n }),
        shared: fc.array(fc.array(fc.nat({ max: n - 1 }), { minLength: 2, maxLength: 3 }), { maxLength: 6 }),
      }),
    );
    fc.assert(
      fc.property(
        sheetArb,
        fc.array(fc.record({ facet: fc.nat(), height: fc.integer({ min: 40, max: 240 }) }), { maxLength: 12 }),
        (spec, requests) => {
          const { catalog, names, collisions: list } = buildSheet(spec);
          const analysis = analysisWith(list);
          const layout = tidy(makeProject({ recipe: makeRecipe({ facets: names }, catalog) }), catalog, analysis, metrics);
          const contested = contestedByFacet(collisions(analysis));
          const sizes: Sizes = {};
          for (const f of catalog.facets) {
            const e = layout[f.name];
            if (e) sizes[f.name] = cardSize(f, { metrics, expanded: false, pins: e.pins, compact: false, contested: contested.get(f.name) ?? [] });
          }
          const traces = routeTraces({ layout, sizes, recipe: makeRecipe({ facets: names }, catalog), catalog, analysis, metrics });
          const ties = traces.filter((t) => t.kind === "tie");
          const notes: NoteRequest[] = [
            ...ties.map((t) => ({ id: t.id, size: { width: 200, height: 140 }, facets: [t.from, t.to], traces: [t.id] })),
            ...requests.map((r, i) => ({ id: `n${i}`, size: { width: 200, height: r.height }, facets: [names[r.facet % names.length] ?? ""] })),
          ];
          const placed = placeNotes({ layout, sizes, traces, notes, metrics });
          expect(placed.map((p) => p.id)).toEqual(notes.map((n) => n.id));
          const cards = rects(layout, sizes);
          placed.forEach((p, i) => {
            for (const c of cards) expect(overlaps(p.rect, c)).toBe(false);
            for (const q of placed.slice(0, i)) expect(overlaps(p.rect, q.rect)).toBe(false);
            const end = p.leader[p.leader.length - 1];
            if (end) {
              const onEdge =
                end.x >= p.rect.x && end.x <= p.rect.x + p.rect.width && end.y >= p.rect.y && end.y <= p.rect.y + p.rect.height;
              expect(onEdge).toBe(true);
              expect(p.leader[0]).toEqual(p.anchor);
            }
          });
          expect(placeNotes({ layout, sizes, traces, notes, metrics })).toEqual(placed);
        },
      ),
      { numRuns: 60 },
    );
  });
});
