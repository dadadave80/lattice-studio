import { expect, test } from "bun:test";
import type { Hex4 } from "@lattice-studio/core";
import { layoutMetrics } from "@/contracts/layout-metrics";
import { GLYPH_LEAD, GUTTER, glyphAnchor, glyphScale, gutterX, stubOffsets, toScreenPoint, tracePaths } from "./geometry";

const rect = { x: 100, y: 200, width: 232, height: 148 };

test("the glyph hangs from the pin-side bottom corner, and the gutter runs 20 units outside that side", () => {
  expect(glyphAnchor(rect, "left")).toEqual({ x: 100, y: 348 });
  expect(glyphAnchor(rect, "right")).toEqual({ x: 332, y: 348 });
  expect(gutterX(rect, "left")).toBe(100 - GUTTER);
  expect(gutterX(rect, "right")).toBe(332 + GUTTER);
});

test("the glyph keeps its screen size down to 50% zoom, then shrinks with the sheet", () => {
  expect(glyphScale(1)).toBe(1);
  expect(glyphScale(2)).toBe(1);
  expect(glyphScale(0.5)).toBe(1);
  expect(glyphScale(0.25)).toBe(0.5);
});

test("a sheet point maps through the transform", () => {
  expect(toScreenPoint({ x: 10, y: 20 }, [5, 7, 2])).toEqual({ x: 25, y: 47 });
});

test("stubs sit at the routed rows' middles, as the card places its handles; a compact card has none", () => {
  const rows: Hex4[] = ["0x00000001", "0x00000002", "0x00000003"];
  const routed = new Set<Hex4>(["0x00000001", "0x00000003"]);
  const { headerHeight, grid, rowHeight } = layoutMetrics;
  expect(stubOffsets(rows, routed, false, layoutMetrics)).toEqual([
    headerHeight + grid + rowHeight / 2,
    headerHeight + grid + 2 * rowHeight + rowHeight / 2,
  ]);
  expect(stubOffsets(rows, routed, true, layoutMetrics)).toEqual([]);
});

test("the trace leaves the glyph, runs the gutter to the rail, the rail to the pad's column and down into the pad", () => {
  const paths = tracePaths({ rect, side: "right", transform: [10, 20, 1], railY: 600, pad: { x: 900, y: 612 }, stubs: [] });
  // Anchor (332, 348) on screen is (342, 368); the lead is 4.5 px below it; the gutter is at x 352 + 10.
  expect(paths.line).toBe(`M342 ${368 + GLYPH_LEAD}H362V600H900V612`);
  expect(paths.stubs).toBe("");
  expect(paths.joints).toEqual([]);
});

test("at 50% zoom the geometry halves with the sheet but the lead keeps its screen length", () => {
  const paths = tracePaths({ rect, side: "left", transform: [0, 0, 0.5], railY: 300, pad: { x: 400, y: 312 }, stubs: [] });
  expect(paths.line).toBe(`M50 ${174 + GLYPH_LEAD}H40V300H400V312`);
});

test("a live trace adds a stub from each routed row into the gutter, joined by a run down to the lead", () => {
  const paths = tracePaths({ rect, side: "left", transform: [0, 0, 1], railY: 600, pad: { x: 400, y: 612 }, stubs: [66, 106] });
  expect(paths.stubs).toBe(`M80 266V${348 + GLYPH_LEAD}M100 266H80M100 306H80`);
  expect(paths.joints).toEqual([{ x: 80, y: 266 }, { x: 80, y: 306 }]);
});
