import { describe, expect, test } from "bun:test";
import {
  centerOn, clampViewport, clampZoom, clearOf, fitBest, fitRect, gridGap, intersects, isViewport, MAX_ZOOM, MIN_ZOOM, percent, sameViewport, toScreen,
  visibleRect, zoomAt, zoomStep, ZOOM_STOPS,
} from "./viewport-math";

describe("zoom range and stops", () => {
  test("clamps to 10-200%", () => {
    expect(clampZoom(0.01)).toBe(MIN_ZOOM);
    expect(clampZoom(5)).toBe(MAX_ZOOM);
    expect(clampZoom(0.8)).toBe(0.8);
    expect(clampZoom(Number.NaN)).toBe(1);
  });

  test("+ and − step through round stops and stop at the ends", () => {
    expect(zoomStep(1, 1)).toBe(1.25);
    expect(zoomStep(1, -1)).toBe(0.75);
    expect(zoomStep(0.8, 1)).toBe(1);
    expect(zoomStep(0.8, -1)).toBe(0.75);
    expect(zoomStep(2, 1)).toBe(2);
    expect(zoomStep(0.1, -1)).toBe(0.1);
    expect(ZOOM_STOPS[0]).toBe(MIN_ZOOM);
    expect(ZOOM_STOPS.at(-1)).toBe(MAX_ZOOM);
  });

  test("percent reads as the readout does", () => {
    expect(percent(0.75)).toBe("75%");
    expect(percent(0.333)).toBe("33%");
  });
});

describe("viewports", () => {
  test("zoomAt keeps the given screen point still", () => {
    const before = { x: 40, y: -20, zoom: 1 };
    const at = { x: 300, y: 200 };
    const after = zoomAt(before, 2, at);
    const sheetBefore = { x: (at.x - before.x) / before.zoom, y: (at.y - before.y) / before.zoom };
    const sheetAfter = { x: (at.x - after.x) / after.zoom, y: (at.y - after.y) / after.zoom };
    expect(sheetAfter.x).toBeCloseTo(sheetBefore.x);
    expect(sheetAfter.y).toBeCloseTo(sheetBefore.y);
    expect(zoomAt(before, 9, at).zoom).toBe(MAX_ZOOM);
  });

  test("clampViewport brings a stored zoom back into range around the sheet's center", () => {
    const size = { width: 800, height: 600 };
    const ok = { x: 10, y: 20, zoom: 1.5 };
    expect(clampViewport(ok, size)).toBe(ok);
    const wild = { x: -1000, y: -800, zoom: 5 };
    const clamped = clampViewport(wild, size);
    expect(clamped.zoom).toBe(MAX_ZOOM);
    const centerBefore = { x: (400 - wild.x) / wild.zoom, y: (300 - wild.y) / wild.zoom };
    expect((400 - clamped.x) / clamped.zoom).toBeCloseTo(centerBefore.x);
    expect((300 - clamped.y) / clamped.zoom).toBeCloseTo(centerBefore.y);
    expect(clampViewport({ x: 0, y: 0, zoom: 0.01 }, size).zoom).toBe(MIN_ZOOM);
  });

  test("centerOn puts the point in the middle", () => {
    const v = centerOn({ x: 100, y: 50 }, { width: 800, height: 600 }, 0.5);
    expect(v).toEqual({ x: 350, y: 275, zoom: 0.5 });
  });

  test("fitRect frames the rect with padding, capped", () => {
    const size = { width: 1000, height: 600 };
    const v = fitRect({ x: 0, y: 0, width: 2000, height: 1000 }, size, { padding: 50 });
    expect(v.zoom).toBeCloseTo(0.45);
    const shown = visibleRect(v, size);
    expect(shown.x).toBeLessThanOrEqual(0);
    expect(shown.x + shown.width).toBeGreaterThanOrEqual(2000);
    expect(fitRect({ x: 0, y: 0, width: 100, height: 100 }, size, { maxZoom: 1 }).zoom).toBe(1);
    expect(fitRect({ x: 0, y: 0, width: 1e6, height: 1e6 }, size).zoom).toBe(MIN_ZOOM);
  });

  test("fitRect frames into the room the floats leave, centered there (SH-02)", () => {
    const size = { width: 1000, height: 600 };
    const rect = { x: 0, y: 0, width: 500, height: 300 };
    // Tool strip 70 px at the left, the title block's column 340 px at the right, the cell's band 160 px below.
    const v = fitRect(rect, size, { padding: 48, insets: { left: 70, right: 340, bottom: 160 } });
    const onScreen = toScreen(rect, v);
    expect(onScreen.x).toBeGreaterThanOrEqual(70 - 0.5);
    expect(onScreen.x + onScreen.width).toBeLessThanOrEqual(1000 - 340 + 0.5);
    expect(onScreen.y).toBeGreaterThanOrEqual(48 - 0.5);
    expect(onScreen.y + onScreen.height).toBeLessThanOrEqual(600 - 160 + 0.5);
    // Without insets it's the symmetric fit, centered on the sheet.
    const plain = fitRect(rect, size, { padding: 48 });
    const center = toScreen(rect, plain);
    expect(center.x + center.width / 2).toBeCloseTo(500);
    expect(center.y + center.height / 2).toBeCloseTo(300);
  });

  test("fitBest takes whichever room frames the rect larger", () => {
    const size = { width: 1000, height: 600 };
    const wide = { x: 0, y: 0, width: 1600, height: 200 };
    const beside = { right: 340, bottom: 120 };
    const under = { bottom: 300 };
    // A wide, short rect gains from the full width: the band under the rail.
    expect(fitBest(wide, size, [under, beside]).zoom).toBeCloseTo(fitRect(wide, size, { insets: under }).zoom);
    const tall = { x: 0, y: 0, width: 300, height: 900 };
    // A tall rect gains from the full height: beside the title block.
    expect(fitBest(tall, size, [under, beside]).zoom).toBeCloseTo(fitRect(tall, size, { insets: beside }).zoom);
    expect(fitBest(tall, size, [])).toEqual(fitRect(tall, size));
  });

  test("toScreen and visibleRect agree", () => {
    const v = { x: -100, y: 40, zoom: 0.5 };
    const shown = visibleRect(v, { width: 400, height: 300 });
    expect(toScreen(shown, v)).toEqual({ x: 0, y: 0, width: 400, height: 300 });
  });

  test("sameViewport ignores sub-pixel noise; isViewport rejects junk", () => {
    expect(sameViewport({ x: 1, y: 2, zoom: 1 }, { x: 1.2, y: 2.1, zoom: 1.0001 })).toBe(true);
    expect(sameViewport({ x: 1, y: 2, zoom: 1 }, { x: 3, y: 2, zoom: 1 })).toBe(false);
    expect(isViewport({ x: 0, y: 0, zoom: 1 })).toBe(true);
    expect(isViewport({ x: 0, y: 0, zoom: 0 })).toBe(false);
    expect(isViewport({ x: "0", y: 0, zoom: 1 })).toBe(false);
    expect(isViewport(null)).toBe(false);
  });

  test("intersects needs shared area", () => {
    expect(intersects({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5, width: 10, height: 10 })).toBe(true);
    expect(intersects({ x: 0, y: 0, width: 10, height: 10 }, { x: 10, y: 0, width: 10, height: 10 })).toBe(false);
  });
});

describe("gridGap", () => {
  test("8 px at 100%, coarser as the view zooms out so the grid never turns into a fill", () => {
    expect(gridGap(1)).toBe(8);
    expect(gridGap(2)).toBe(8);
    expect(gridGap(0.75)).toBe(8);
    expect(gridGap(0.5)).toBe(16);
    expect(gridGap(0.1)).toBe(64);
  });
});

describe("clearOf (2.4.11)", () => {
  const area = { x: 0, y: 0, width: 1000, height: 700 };

  test("a card already clear doesn't move", () => {
    expect(clearOf({ x: 300, y: 300, width: 232, height: 120 }, area, [], 16)).toEqual({ dx: 0, dy: 0 });
  });

  test("an off-screen card comes inside the margin", () => {
    expect(clearOf({ x: 1200, y: 300, width: 232, height: 120 }, area, [], 16)).toEqual({ dx: -448, dy: 0 });
    expect(clearOf({ x: 100, y: -500, width: 232, height: 120 }, area, [], 16)).toEqual({ dx: 0, dy: 516 });
  });

  test("a card under the title block moves the shortest way clear of it", () => {
    const titleBlock = { x: 700, y: 500, width: 300, height: 200 };
    const card = { x: 720, y: 540, width: 232, height: 120 };
    const { dx, dy } = clearOf(card, area, [titleBlock], 16);
    const moved = { ...card, x: card.x + dx, y: card.y + dy };
    expect(intersects(moved, { x: 684, y: 484, width: 332, height: 232 })).toBe(false);
    // Up by the overlap plus the margin is shorter than left past the block.
    expect({ dx, dy }).toEqual({ dx: 0, dy: 484 - (540 + 120) });
  });

  test("clears the tool strip and the title block together", () => {
    const toolStrip = { x: 0, y: 0, width: 48, height: 300 };
    const titleBlock = { x: 700, y: 500, width: 300, height: 200 };
    const card = { x: 10, y: 10, width: 232, height: 120 };
    const { dx, dy } = clearOf(card, area, [toolStrip, titleBlock], 16);
    const moved = { ...card, x: card.x + dx, y: card.y + dy };
    expect(intersects(moved, { x: -16, y: -16, width: 80, height: 332 })).toBe(false);
    expect(intersects(moved, { x: 684, y: 484, width: 332, height: 232 })).toBe(false);
  });

  test("a card bigger than the room aligns its top-left corner", () => {
    expect(clearOf({ x: -50, y: -50, width: 2000, height: 2000 }, area, [], 16)).toEqual({ dx: 66, dy: 66 });
  });
});
