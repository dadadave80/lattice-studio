import { describe, expect, test } from "bun:test";
import { layoutSizes } from "../../../tokens/dist/tokens";
import type { Analysis } from "../model/analysis";
import type { CardSize, LayoutMetrics } from "../model/layout";
import { makeCatalog, makeProject, makeRecipe } from "../testing/builders";
import { sel } from "../testing/ids";
import { contestedSelectors } from "./contested";
import { snapUp } from "./geometry";
import { visibleSelectors } from "./rows";
import { cardSize } from "./size";
import { analysisWith, facetWith } from "./testkit";
import { tidy } from "./tidy";
import { routeTraces } from "./traces";

const metrics: LayoutMetrics = layoutSizes;
const shared = Array.from({ length: 7 }, (_, i) => sel(9000 + i));
const x = sel(9100);
// A and B collide on 7 selectors (more than the 6 collapsed rows); A and C on one more; D contends nothing.
const catalog = makeCatalog({
  facets: [
    facetWith("A", 12, 1, [...shared, x]),
    facetWith("B", 12, 100, shared),
    facetWith("C", 3, 200, [x]),
    facetWith("D", 15, 300),
  ],
});
const names = ["A", "B", "C", "D"];
const analysis: Analysis = analysisWith([
  ...shared.map((selector) => ({ selector, contenders: ["A", "B"] })),
  { selector: x, contenders: ["A", "C"] },
]);

describe("contestedSelectors", () => {
  test("per facet, in problem order; a facet that contends nothing gets []", () => {
    expect(contestedSelectors(analysis, "A")).toEqual([...shared, x]);
    expect(contestedSelectors(analysis, "B")).toEqual(shared);
    expect(contestedSelectors(analysis, "C")).toEqual([x]);
    expect(contestedSelectors(analysis, "D")).toEqual([]);
    expect(contestedSelectors(analysis, "Nope")).toEqual([]);
  });

  test("without a facet, every contested selector once", () => {
    expect(contestedSelectors(analysis)).toEqual([...shared, x]);
    expect(contestedSelectors(analysisWith())).toEqual([]);
  });

  test("routing alone makes nothing contested: only SEL-01 does", () => {
    const routed: Analysis = {
      ...analysisWith(),
      routing: { [x]: { owner: "A", contenders: ["A", "C"], via: "default" } },
    };
    expect(contestedSelectors(routed, "A")).toEqual([]);
  });

  test("cardSize, tidy and routeTraces agree on rows when they all use it", () => {
    const sizes: Record<string, CardSize> = {};
    for (const f of catalog.facets) {
      sizes[f.name] = cardSize(f, { metrics, expanded: false, pins: "right", compact: false, contested: contestedSelectors(analysis, f.name) });
    }
    // D isn't a contender: same size as with no contested rows at all.
    const d = catalog.facets[3];
    expect(d && cardSize(d, { metrics, expanded: false, pins: "right", compact: false, contested: [] })).toEqual(sizes["D"]);
    expect(sizes["A"]).toMatchObject({ rows: 8, hidden: 12 });

    // Tidy stacks the band with exactly these heights (all four are band 0, catalog order).
    const layout = tidy(makeProject({ recipe: makeRecipe({ facets: names }, catalog) }), catalog, analysis, metrics);
    let y = 96;
    for (const name of names) {
      if (y > 96 && y + (sizes[name]?.height ?? 0) > 96 + 1040) y = 96;
      expect(layout[name]?.y).toBe(y);
      y = snapUp(y + (sizes[name]?.height ?? 0) + 40, 8);
    }

    // Every tie lands on the center of the row the drawn card shows for its selector.
    const traces = routeTraces({ layout, sizes, recipe: makeRecipe({ facets: names }, catalog), catalog, analysis, metrics });
    const ties = traces.filter((t) => t.kind === "tie");
    expect(ties).toHaveLength(8);
    for (const tie of ties) {
      const ends = [
        { name: tie.from, point: tie.points[0] },
        { name: tie.to, point: tie.points[tie.points.length - 1] },
      ];
      for (const { name, point } of ends) {
        const facet = catalog.facets.find((f) => f.name === name);
        const entry = layout[name];
        if (!facet || !entry || !point || !tie.selector) throw new Error("missing tie end");
        const rows = visibleSelectors(facet, false, contestedSelectors(analysis, name), metrics);
        const row = rows.indexOf(tie.selector);
        expect(row).toBeGreaterThanOrEqual(0);
        expect(row).toBeLessThan(sizes[name]?.rows ?? 0);
        expect(point.y).toBe(entry.y + 48 + 8 + row * 20 + 10);
      }
    }
  });
});
