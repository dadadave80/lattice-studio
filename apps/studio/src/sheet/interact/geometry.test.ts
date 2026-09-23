import { describe, expect, test } from "bun:test";
import type { Layout, LayoutMetrics, Sizes } from "@lattice-studio/core";
import {
  edgeScroll, groupBounds, marqueeHits, nearestInDirection, settledOffset, snap, spanRect, toggled, union,
} from "./geometry";

const metrics: LayoutMetrics = {
  grid: 8, snap: 8, cardWidth: 232, headerHeight: 40, rowHeight: 20, footerHeight: 24, collapsedRows: 6,
  expandThreshold: 9, compactZoom: 0.4, noteWidth: 240, traceLabelZoom: 0.75,
};

function card(x: number, y: number) {
  return { x, y, pins: "left" as const };
}

const size = { width: 200, height: 100 };

describe("snap", () => {
  test("rounds to the 8 px lattice", () => {
    expect(snap(11, 8)).toBe(8);
    expect(snap(12, 8)).toBe(16);
    expect(snap(-3, 8) === 0).toBe(true);
  });
});

describe("groupBounds", () => {
  test("spans the placed cards and ignores the rest", () => {
    const layout: Layout = { A: card(0, 0), B: card(300, 200) };
    const sizes: Sizes = { A: size, B: size };
    expect(groupBounds(layout, sizes, ["A", "B", "Gone"], metrics)).toEqual({ x: 0, y: 0, width: 500, height: 300 });
    expect(groupBounds(layout, sizes, ["Gone"], metrics)).toBeNull();
  });
});

describe("settledOffset", () => {
  const layout: Layout = { A: card(0, 0), B: card(400, 0) };
  const sizes: Sizes = { A: size, B: size };

  test("a drop on empty sheet stays where it was dropped", () => {
    expect(settledOffset(layout, sizes, ["A"], { x: 0, y: 200 }, metrics)).toEqual({ x: 0, y: 200 });
  });

  test("a drop onto another card slides to the nearest free slot, flush against it", () => {
    const by = settledOffset(layout, sizes, ["A"], { x: 360, y: 0 }, metrics);
    const landed = { x: 0 + by.x, y: 0 + by.y, ...size };
    const b = { x: 400, y: 0, ...size };
    const overlaps = landed.x < b.x + b.width && landed.x + landed.width > b.x && landed.y < b.y + b.height && landed.y + landed.height > b.y;
    expect(overlaps).toBe(false);
    // Nearest to the drop point (360, 0): flush above B (104 away) beats flush left of it (160 away).
    expect(by).toEqual({ x: 360, y: -104 });
  });

  test("a group keeps its shape when it slides", () => {
    const three: Layout = { ...layout, C: card(0, 200) };
    const by = settledOffset(three, { ...sizes, C: size }, ["A", "C"], { x: 400, y: 0 }, metrics);
    expect(by.x === 400 && by.y === 0).toBe(false);
  });
});

describe("marqueeHits", () => {
  test("cards the rectangle touches, edges included", () => {
    const layout: Layout = { A: card(0, 0), B: card(300, 0), C: card(0, 300) };
    const sizes: Sizes = { A: size, B: size, C: size };
    expect(marqueeHits(layout, sizes, spanRect({ x: 150, y: 50 }, { x: 310, y: 60 }), metrics)).toEqual(["A", "B"]);
    expect(marqueeHits(layout, sizes, spanRect({ x: 200, y: 100 }, { x: 250, y: 150 }), metrics)).toEqual(["A"]);
    expect(marqueeHits(layout, sizes, spanRect({ x: 210, y: 110 }, { x: 250, y: 150 }), metrics)).toEqual([]);
  });
});

describe("selection helpers", () => {
  test("toggled adds and removes", () => {
    expect(toggled(["A"], "B")).toEqual(["A", "B"]);
    expect(toggled(["A", "B"], "A")).toEqual(["B"]);
  });

  test("union keeps the base order", () => {
    expect(union(["B", "A"], ["A", "C"])).toEqual(["B", "A", "C"]);
  });
});

describe("nearestInDirection", () => {
  // A B
  //   C  D
  const layout: Layout = { A: card(0, 0), B: card(300, 0), C: card(300, 160), D: card(600, 200) };
  const sizes: Sizes = { A: size, B: size, C: size, D: size };

  test("prefers the card in the same row over a nearer one off to the side", () => {
    expect(nearestInDirection(layout, sizes, "A", "right", metrics)).toBe("B");
    expect(nearestInDirection(layout, sizes, "C", "right", metrics)).toBe("D");
    expect(nearestInDirection(layout, sizes, "B", "down", metrics)).toBe("C");
    expect(nearestInDirection(layout, sizes, "C", "up", metrics)).toBe("B");
    expect(nearestInDirection(layout, sizes, "B", "left", metrics)).toBe("A");
  });

  test("null when nothing lies that way", () => {
    expect(nearestInDirection(layout, sizes, "A", "left", metrics)).toBeNull();
    expect(nearestInDirection(layout, sizes, "A", "up", metrics)).toBeNull();
    expect(nearestInDirection(layout, sizes, "Gone", "up", metrics)).toBeNull();
  });
});

describe("edgeScroll", () => {
  const sheet = { width: 1000, height: 700 };

  test("nothing away from the edges", () => {
    expect(edgeScroll({ x: 500, y: 350 }, sheet)).toEqual({ x: 0, y: 0 });
    expect(edgeScroll({ x: 48, y: 652 }, sheet)).toEqual({ x: 0, y: 0 });
  });

  test("faster the deeper the pointer goes into the 48 px zone", () => {
    const shallow = edgeScroll({ x: 40, y: 350 }, sheet).x;
    const deep = edgeScroll({ x: 8, y: 350 }, sheet).x;
    expect(shallow).toBeGreaterThan(0);
    expect(deep).toBeGreaterThan(shallow);
    expect(edgeScroll({ x: -30, y: 350 }, sheet).x).toBe(20);
  });

  test("the right and bottom edges pan the other way", () => {
    const at = edgeScroll({ x: 990, y: 695 }, sheet);
    expect(at.x).toBeLessThan(0);
    expect(at.y).toBeLessThan(0);
  });
});
