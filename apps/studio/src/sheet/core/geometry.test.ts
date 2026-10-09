import { describe, expect, test } from "bun:test";
import type { Hex4 } from "@lattice-studio/core";
import { layoutMetrics } from "@/contracts/layout-metrics";
import { crossings, GLYPH_LEAD, GUTTER, glyphAnchor, glyphScale, gutterX, RAIL_GAP, runY, stubOffsets, tracePaths } from "./geometry";

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
  expect(paths.origin).toEqual({ x: 110, y: 220 });
  expect(paths.stubs).toBe("");
  expect(paths.joints).toEqual([]);
});

test("at 50% zoom the geometry halves with the sheet but the lead keeps its screen length", () => {
  const paths = tracePaths({ rect, side: "left", transform: [0, 0, 0.5], railY: 300, pad: { x: 400, y: 312 }, stubs: [] });
  expect(paths.line).toBe(`M50 ${174 + GLYPH_LEAD}H40V300H400V312`);
});

test("a live trace adds a stub from each routed row into the gutter, joined by a run down to the lead, from the card's corner", () => {
  const paths = tracePaths({ rect, side: "left", transform: [0, 0, 1], railY: 600, pad: { x: 400, y: 612 }, stubs: [66, 106] });
  expect(paths.origin).toEqual({ x: 100, y: 200 });
  expect(paths.stubs).toBe(`M-20 66V${148 + GLYPH_LEAD}M0 66H-20M0 106H-20`);
  expect(paths.joints).toEqual([{ x: -20, y: 66 }, { x: -20, y: 106 }]);
});

test("a moved card moves the wire and the origin; its stubs keep their shape", () => {
  const base = { side: "right" as const, railY: 600, pad: { x: 900, y: 612 }, stubs: [66] };
  const here = tracePaths({ ...base, rect, transform: [0, 0, 1] });
  const there = tracePaths({ ...base, rect: { ...rect, x: rect.x + 40, y: rect.y + 16 }, transform: [0, 0, 1] });
  expect(there.line).not.toBe(here.line);
  expect(there.origin).toEqual({ x: here.origin.x + 40, y: here.origin.y + 16 });
  expect(there.stubs).toBe(here.stubs);
  expect(there.joints).toEqual(here.joints);
  // The right side's stubs run out from the card's right edge to the gutter beyond it.
  expect(here.stubs).toBe(`M252 66V${148 + GLYPH_LEAD}M232 66H252`);
});

describe("a card across the run (CO-01)", () => {
  // Votes, in the review's 1440 shot: a card the rail runs straight through, between the gutter and the pad.
  const votes = { x: 400, y: 560, width: 250, height: 80 };

  test("the run keeps to the rail while nothing lies across it", () => {
    expect(runY(362, 900, 600, 700, [], null)).toBe(600);
    expect(runY(362, 900, 600, 700, [{ x: 400, y: 100, width: 250, height: 80 }], null)).toBe(600);
  });

  test("drops just below a card in the way, while it stays above the cell", () => {
    expect(runY(362, 900, 600, 700, [votes], null)).toBe(640 + RAIL_GAP);
    // And below a second card the drop meets.
    expect(runY(362, 900, 600, 700, [votes, { x: 700, y: 620, width: 100, height: 60 }], null)).toBe(680 + RAIL_GAP);
  });

  test("stays on the rail, to be bridged, when the drop would pass the cell's top or run behind the title block", () => {
    expect(runY(362, 900, 600, 640, [votes], null)).toBe(600);
    expect(runY(362, 900, 600, 700, [votes], 880)).toBe(600);
  });

  test("a wire's crossings are the stretches over other cards, gutter and run alike", () => {
    const points = [{ x: 342, y: 372 }, { x: 362, y: 372 }, { x: 362, y: 600 }, { x: 900, y: 600 }, { x: 900, y: 612 }];
    const gutterCard = { x: 300, y: 400, width: 100, height: 50 };
    expect(crossings(points, [])).toBe("");
    expect(crossings(points, [votes, gutterCard])).toBe("M362 400V450M400 600H650");
  });

  test("the trace drops below the card, and bridges it where it can't", () => {
    const transform = [10, 20, 1] as const;
    const base = { rect, side: "right" as const, transform, railY: 600, pad: { x: 900, y: 712 }, stubs: [] };
    const dropped = tracePaths({ ...base, floorY: 700, obstacles: [votes] });
    expect(dropped.line).toBe(`M342 ${368 + GLYPH_LEAD}H362V${640 + RAIL_GAP}H900V712`);
    expect(dropped.bridges).toBe("");
    const bridged = tracePaths({ ...base, floorY: 620, obstacles: [votes] });
    expect(bridged.line).toBe(`M342 ${368 + GLYPH_LEAD}H362V600H900V712`);
    expect(bridged.bridges).toBe("M400 600H650");
  });
});
