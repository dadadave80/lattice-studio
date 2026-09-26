import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import type { Point, Rect, Size } from "../model/layout";
import { nearestFree, overlaps, snap, snapDown, snapUp } from "./geometry";

/** The search as it was first written: every candidate, sorted by (distance, y, x), the first free one. */
function reference(obstacles: readonly Rect[], at: Point, size: Size, step: number, pad = 0): Point {
  const start = { x: snap(at.x, step), y: snap(at.y, step) };
  const free = (p: Point): boolean => !obstacles.some((o) => overlaps({ ...p, ...size }, o, pad));
  if (free(start)) return start;
  const xs = new Set<number>([start.x]);
  const ys = new Set<number>([start.y]);
  for (const o of obstacles) {
    xs.add(snapUp(o.x + o.width + pad, step));
    xs.add(snapDown(o.x - pad - size.width, step));
    ys.add(snapUp(o.y + o.height + pad, step));
    ys.add(snapDown(o.y - pad - size.height, step));
  }
  const candidates: { x: number; y: number; d: number }[] = [];
  for (const x of xs) for (const y of ys) candidates.push({ x, y, d: (x - at.x) ** 2 + (y - at.y) ** 2 });
  candidates.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x);
  const found = candidates.find(free);
  if (!found) throw new Error("no free candidate");
  return { x: found.x, y: found.y };
}

const rectArb = fc.record({
  x: fc.integer({ min: -600, max: 1200 }),
  y: fc.integer({ min: -600, max: 1200 }),
  width: fc.integer({ min: 8, max: 400 }),
  height: fc.integer({ min: 8, max: 400 }),
});

describe("nearestFree", () => {
  test("a free point is the snapped point itself", () => {
    expect(nearestFree([], { x: 13, y: 21 }, { width: 100, height: 40 }, 8)).toEqual({ x: 16, y: 24 });
  });

  test("next to one obstacle, the nearest side wins, and a tie goes to the smaller y", () => {
    const box = { x: 0, y: 0, width: 100, height: 100 };
    // Centered on the box's right edge: out to the right is nearest.
    expect(nearestFree([box], { x: 90, y: 0 }, { width: 40, height: 40 }, 8)).toEqual({ x: 104, y: 0 });
    // Equidistant above and below: above (smaller y).
    expect(nearestFree([{ x: -400, y: 0, width: 1200, height: 96 }], { x: 0, y: 28 }, { width: 40, height: 40 }, 8)).toEqual({ x: 0, y: -40 });
  });

  test("the answer never overlaps an obstacle, with the clearance asked for", () => {
    fc.assert(
      fc.property(fc.array(rectArb, { maxLength: 40 }), rectArb, fc.integer({ min: 0, max: 16 }), (obstacles, box, pad) => {
        const at = nearestFree(obstacles, box, box, 8, pad);
        expect(obstacles.some((o) => overlaps({ ...at, width: box.width, height: box.height }, o, pad))).toBe(false);
      }),
    );
  });

  test("matches the full candidate search exactly, ties included", () => {
    fc.assert(
      fc.property(
        fc.array(rectArb, { maxLength: 40 }),
        rectArb,
        fc.constantFrom(1, 4, 8, 16),
        fc.integer({ min: 0, max: 16 }),
        (obstacles, box, step, pad) => {
          const size = { width: box.width, height: box.height };
          expect(nearestFree(obstacles, box, size, step, pad)).toEqual(reference(obstacles, box, size, step, pad));
        },
      ),
      { numRuns: 400 },
    );
  });

  test("a dense grid of cards: the same answer as the full search", () => {
    const cards: Rect[] = [];
    for (let row = 0; row < 6; row++) for (let col = 0; col < 6; col++) cards.push({ x: col * 256, y: row * 208, width: 232, height: 200 });
    for (const at of [{ x: 300, y: 300 }, { x: 0, y: 0 }, { x: 700, y: 900 }]) {
      const size = { width: 232, height: 120 };
      expect(nearestFree(cards, at, size, 8, 8)).toEqual(reference(cards, at, size, 8, 8));
    }
  });
});
