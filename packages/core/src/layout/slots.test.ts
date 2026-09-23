import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { layoutSizes } from "../../../tokens/dist/tokens";
import type { Layout, LayoutMetrics, Point, Size, Sizes } from "../model/layout";
import { overlaps } from "./geometry";
import { contentBounds, freeSlot, pushBelow } from "./slots";
import { overlapping } from "./testkit";

const metrics: LayoutMetrics = layoutSizes;
const W = 232;

const cardArb = fc.record({
  height: fc.integer({ min: 68, max: 520 }),
  at: fc.record({ x: fc.integer({ min: -400, max: 1600 }), y: fc.integer({ min: -400, max: 1600 }) }),
});

/** Places cards one by one through `freeSlot`, as the sheet does. */
function placeAll(cards: readonly { height: number; at: Point }[]): { layout: Layout; sizes: Sizes } {
  const layout: Layout = {};
  const sizes: Sizes = {};
  cards.forEach((card, i) => {
    const name = `C${String(i).padStart(2, "0")}`;
    const size = { width: W, height: card.height };
    const at = freeSlot(layout, sizes, card.at, size, metrics);
    layout[name] = { ...at, pins: "right" };
    sizes[name] = size;
  });
  return { layout, sizes };
}

describe("freeSlot", () => {
  test("a free drop point lands where dropped, snapped to 8 px", () => {
    expect(freeSlot({}, {}, { x: 101, y: 45 }, { width: W, height: 100 }, metrics)).toEqual({ x: 104, y: 48 });
  });

  test("a drop onto a card slides to the nearest free spot", () => {
    const layout: Layout = { A: { x: 0, y: 0, pins: "right" } };
    const sizes: Sizes = { A: { width: W, height: 200 } };
    // Dropped near A's right edge: the nearest free spot is flush right of it.
    expect(freeSlot(layout, sizes, { x: 200, y: 16 }, { width: W, height: 100 }, metrics)).toEqual({ x: 232, y: 16 });
    // Dropped near A's bottom: flush below it.
    expect(freeSlot(layout, sizes, { x: 8, y: 180 }, { width: W, height: 100 }, metrics)).toEqual({ x: 8, y: 200 });
  });

  test("the spot is the nearest free point on the 8 px lattice (checked against a brute-force spiral)", () => {
    fc.assert(
      fc.property(fc.array(cardArb, { maxLength: 8 }), cardArb, (cards, drop) => {
        const { layout, sizes } = placeAll(cards.map((c) => ({ ...c, at: { x: c.at.x / 4, y: c.at.y / 4 } })));
        const size: Size = { width: W, height: drop.height };
        const at = { x: drop.at.x / 4, y: drop.at.y / 4 };
        const got = freeSlot(layout, sizes, at, size, metrics);
        const rects = Object.entries(layout).map(([n, e]) => ({ x: e.x, y: e.y, width: sizes[n]?.width ?? 0, height: sizes[n]?.height ?? 0 }));
        const free = (p: Point) => !rects.some((r) => overlaps({ ...p, ...size }, r));
        expect(free(got)).toBe(true);
        const d2 = (p: Point) => (p.x - at.x) ** 2 + (p.y - at.y) ** 2;
        // No lattice point strictly nearer is free: walk the spiral out to the found distance.
        const reach = Math.ceil(Math.sqrt(d2(got)) / 8) + 1;
        const cx = Math.round(at.x / 8);
        const cy = Math.round(at.y / 8);
        for (let i = cx - reach; i <= cx + reach; i++) {
          for (let j = cy - reach; j <= cy + reach; j++) {
            const p = { x: i * 8, y: j * 8 };
            if (d2(p) < d2(got) - 1e-9) expect(free(p)).toBe(false);
          }
        }
      }),
      { numRuns: 60 },
    );
  });

  test("property: 60 cards placed through freeSlot never overlap, sit on the 8 px grid, and repeat exactly", () => {
    fc.assert(
      fc.property(fc.array(cardArb, { minLength: 1, maxLength: 60 }), (cards) => {
        const first = placeAll(cards);
        expect(overlapping(first.layout, first.sizes, metrics)).toEqual([]);
        for (const e of Object.values(first.layout)) {
          expect(e.x % 8 === 0 && e.y % 8 === 0).toBe(true);
        }
        expect(placeAll(cards)).toEqual(first);
      }),
      { numRuns: 40 },
    );
  });

  test("a crowded sheet (60 cards dropped at one point) still stacks none", () => {
    const { layout, sizes } = placeAll(Array.from({ length: 60 }, (_, i) => ({ height: 100 + (i % 7) * 40, at: { x: 0, y: 0 } })));
    expect(Object.keys(layout)).toHaveLength(60);
    expect(overlapping(layout, sizes, metrics)).toEqual([]);
  });
});

describe("pushBelow", () => {
  const sizes: Sizes = {
    A: { width: W, height: 200 },
    B: { width: W, height: 100 },
    C: { width: W, height: 100 },
    D: { width: W, height: 100 },
    E: { width: W, height: 100 },
  };
  const layout: Layout = {
    A: { x: 0, y: 0, pins: "right", expanded: true },
    B: { x: 0, y: 240, pins: "right" },
    C: { x: 100, y: 400, pins: "left" },
    D: { x: 400, y: 240, pins: "right" },
    E: { x: 300, y: 520, pins: "right" },
  };

  test("cards below in the same column move down, snapped up to 8 px; other columns stay", () => {
    const out = pushBelow(layout, sizes, "A", 100, metrics);
    expect(out["B"]).toEqual({ x: 0, y: 344, pins: "right" });
    expect(out["C"]).toEqual({ x: 100, y: 504, pins: "left" });
    expect(out["D"]).toEqual(layout["D"]);
    expect(out["A"]).toEqual(layout["A"]);
  });

  test("a card in a staggered column that a moved card would land on moves too", () => {
    const out = pushBelow(layout, sizes, "A", 100, metrics);
    // E (x 300..532) isn't in A's column, but C moves to x 100..332, y 504..604, which would cover it.
    expect(out["E"]).toEqual({ x: 300, y: 624, pins: "right" });
    const grown = { ...sizes, A: { width: W, height: 300 } };
    expect(overlapping(out, grown, metrics)).toEqual([]);
  });

  test("a negative or zero dy pulls nothing up and returns the layout itself", () => {
    expect(pushBelow(layout, sizes, "A", -100, metrics)).toBe(layout);
    expect(pushBelow(layout, sizes, "A", 0, metrics)).toBe(layout);
  });

  test("a facet not on the sheet changes nothing", () => {
    expect(pushBelow(layout, sizes, "Z", 40, metrics)).toBe(layout);
  });

  test("the input isn't mutated", () => {
    const copy = structuredClone(layout);
    pushBelow(layout, sizes, "A", 100, metrics);
    expect(layout).toEqual(copy);
  });

  test("property: after growing any card by any dy, no two cards overlap, nothing moves up, and it repeats exactly", () => {
    fc.assert(
      fc.property(
        fc.array(cardArb, { minLength: 1, maxLength: 60 }),
        fc.nat(),
        fc.integer({ min: -300, max: 900 }),
        (cards, pick, dy) => {
          const { layout: l, sizes: s } = placeAll(cards);
          const names = Object.keys(l);
          const facet = names[pick % names.length] ?? "C00";
          const out = pushBelow(l, s, facet, dy, metrics);
          expect(pushBelow(l, s, facet, dy, metrics)).toEqual(out);
          const own = s[facet] ?? { width: W, height: 0 };
          const grown = { ...s, [facet]: { width: own.width, height: own.height + Math.max(0, dy) } };
          expect(overlapping(out, grown, metrics)).toEqual([]);
          for (const n of names) {
            const before = l[n];
            const after = out[n];
            expect(after?.x).toBe(before?.x ?? 0);
            expect((after?.y ?? 0) >= (before?.y ?? 0)).toBe(true);
            if (dy <= 0) expect(after).toEqual(before);
          }
        },
      ),
      { numRuns: 60 },
    );
  });
});

describe("contentBounds", () => {
  test("null for an empty sheet", () => {
    expect(contentBounds({}, {})).toBeNull();
  });

  test("the union of every card", () => {
    const layout: Layout = { A: { x: -40, y: 16, pins: "right" }, B: { x: 400, y: 200, pins: "left" } };
    const sizes: Sizes = { A: { width: W, height: 100 }, B: { width: W, height: 300 } };
    expect(contentBounds(layout, sizes)).toEqual({ x: -40, y: 16, width: 672, height: 484 });
  });
});
