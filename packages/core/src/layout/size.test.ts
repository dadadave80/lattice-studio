import { describe, expect, test } from "bun:test";
import { layoutSizes } from "../../../tokens/dist/tokens";
import type { Hex4 } from "../model/hex";
import type { CardSizeOptions, LayoutMetrics } from "../model/layout";
import { sel } from "../testing/ids";
import { visibleSelectors } from "./rows";
import { cardSize } from "./size";
import { facetWith } from "./testkit";

const metrics: LayoutMetrics = layoutSizes;
const base: CardSizeOptions = { metrics, expanded: false, pins: "right", compact: false, contested: [] };
// header 48 + pins pad 8 top and bottom + footer 28
const chrome = 48 + 16 + 28;

describe("cardSize", () => {
  test("a card with up to 9 selectors shows every row and no control", () => {
    expect(cardSize(facetWith("A", 5), base)).toEqual({ width: 232, height: chrome + 5 * 20, rows: 5, hidden: 0 });
    expect(cardSize(facetWith("A", 9), base)).toEqual({ width: 232, height: chrome + 9 * 20, rows: 9, hidden: 0 });
  });

  test("more than 9 selectors collapse to 6 rows plus \"+ n more\"", () => {
    expect(cardSize(facetWith("A", 17), base)).toEqual({ width: 232, height: chrome + 7 * 20, rows: 6, hidden: 11 });
    expect(cardSize(facetWith("A", 10), base)).toMatchObject({ rows: 6, hidden: 4 });
  });

  test("expanded shows every row plus the Collapse control", () => {
    const size = cardSize(facetWith("A", 17), { ...base, expanded: true });
    expect(size).toEqual({ width: 232, height: chrome + 18 * 20, rows: 17, hidden: 0 });
  });

  test("expanded makes no difference at 9 selectors or fewer", () => {
    expect(cardSize(facetWith("A", 9), { ...base, expanded: true })).toEqual(cardSize(facetWith("A", 9), base));
  });

  test("contested rows never hide: they take the collapsed rows first, then the rest in order", () => {
    const facet = facetWith("A", 12, 1);
    const contested = [sel(11), sel(12)];
    expect(cardSize(facet, { ...base, contested })).toMatchObject({ rows: 6, hidden: 6 });
    expect(visibleSelectors(facet, false, contested, metrics)).toEqual([sel(1), sel(2), sel(3), sel(4), sel(11), sel(12)]);
  });

  test("more contested rows than 6 all show", () => {
    const facet = facetWith("A", 12, 1);
    const contested = [1, 3, 5, 7, 9, 11, 12].map((n) => sel(n));
    expect(cardSize(facet, { ...base, contested })).toEqual({ width: 232, height: chrome + 8 * 20, rows: 7, hidden: 5 });
  });

  test("when every row is contested nothing hides, so no control row", () => {
    const facet = facetWith("A", 10, 1);
    const contested = Array.from({ length: 10 }, (_, i) => sel(i + 1));
    expect(cardSize(facet, { ...base, contested })).toEqual({ width: 232, height: chrome + 10 * 20, rows: 10, hidden: 0 });
  });

  test("contested selectors the facet doesn't export are ignored", () => {
    const contested: Hex4[] = [sel(999)];
    expect(cardSize(facetWith("A", 17), { ...base, contested })).toEqual(cardSize(facetWith("A", 17), base));
  });

  test("compact is the header plus a one-row tick strip", () => {
    expect(cardSize(facetWith("A", 17), { ...base, compact: true })).toEqual({ width: 232, height: 48 + 20, rows: 0, hidden: 0 });
  });

  test("pins side doesn't change the size", () => {
    expect(cardSize(facetWith("A", 12), { ...base, pins: "left" })).toEqual(cardSize(facetWith("A", 12), base));
  });

  test("sizes follow the metrics passed in, not constants", () => {
    const other: LayoutMetrics = { ...metrics, cardWidth: 300, headerHeight: 40, rowHeight: 24, footerHeight: 20, grid: 4, collapsedRows: 4, expandThreshold: 5 };
    expect(cardSize(facetWith("A", 8), { ...base, metrics: other })).toEqual({
      width: 300,
      height: 40 + 8 + 5 * 24 + 20,
      rows: 4,
      hidden: 4,
    });
  });
});
