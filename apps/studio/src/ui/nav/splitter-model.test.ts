import { describe, expect, test } from "bun:test";
import {
  clampSize, dragSize, narrower, splitterKey, splitterValueText, wider, type SplitterKeyInput,
} from "./splitter-model";

const left: SplitterKeyInput = {
  value: 240, min: 200, max: 360, orientation: "vertical", paneSide: "before", step: 8, largeStep: 32,
};

describe("splitterKey", () => {
  test("→ grows a pane before a vertical splitter and ← shrinks it", () => {
    expect(splitterKey("ArrowRight", false, left)).toEqual({ kind: "resize", value: 248 });
    expect(splitterKey("ArrowLeft", false, left)).toEqual({ kind: "resize", value: 232 });
    expect(splitterKey("ArrowLeft", true, left)).toEqual({ kind: "resize", value: 208 });
  });

  test("a pane after the splitter moves the other way", () => {
    const inspector = { ...left, value: 316, min: 280, max: 420, paneSide: "after" as const };
    expect(splitterKey("ArrowLeft", false, inspector)).toEqual({ kind: "resize", value: 324 });
    expect(splitterKey("ArrowRight", true, inspector)).toEqual({ kind: "resize", value: 284 });
  });

  test("a horizontal splitter takes ↑ ↓ and ignores ← →", () => {
    const consoleDrawer = { ...left, value: 160, min: 36, max: 450, orientation: "horizontal" as const, paneSide: "after" as const };
    expect(splitterKey("ArrowUp", false, consoleDrawer)).toEqual({ kind: "resize", value: 168 });
    expect(splitterKey("ArrowDown", false, consoleDrawer)).toEqual({ kind: "resize", value: 152 });
    expect(splitterKey("ArrowLeft", false, consoleDrawer)).toBeNull();
    expect(splitterKey("ArrowUp", false, left)).toBeNull();
  });

  test("clamps, and Home, End and Enter", () => {
    expect(splitterKey("ArrowLeft", true, { ...left, value: 210 })).toEqual({ kind: "resize", value: 200 });
    expect(splitterKey("ArrowRight", true, { ...left, value: 350 })).toEqual({ kind: "resize", value: 360 });
    expect(splitterKey("Home", false, left)).toEqual({ kind: "resize", value: 200 });
    expect(splitterKey("End", false, left)).toEqual({ kind: "resize", value: 360 });
    expect(splitterKey("Enter", false, left)).toEqual({ kind: "toggle" });
    expect(splitterKey("a", false, left)).toBeNull();
  });
});

describe("helpers", () => {
  test("clampSize", () => {
    expect(clampSize(10, { min: 200, max: 360 })).toBe(200);
    expect(clampSize(999, { min: 200, max: 360 })).toBe(360);
    expect(clampSize(250, { min: 200, max: 360 })).toBe(250);
  });

  test("narrower and wider step and stop at the bounds", () => {
    expect(narrower(240, { min: 200 })).toBe(232);
    expect(narrower(204, { min: 200 })).toBe(200);
    expect(wider(240, { max: 360, step: 32 })).toBe(272);
    expect(wider(356, { max: 360 })).toBe(360);
  });

  test("dragSize follows the pointer, inverted for a pane after the splitter", () => {
    expect(dragSize(240, 30, "before", { min: 200, max: 360 })).toBe(270);
    expect(dragSize(316, 30, "after", { min: 280, max: 420 })).toBe(286);
    expect(dragSize(240, -100, "before", { min: 200, max: 360 })).toBe(200);
  });
});

describe("splitterValueText", () => {
  test("says where the pane sits between its bounds, in words", () => {
    const bounds = { min: 200, max: 360 };
    expect(splitterValueText(240, bounds, "vertical", false)).toBe("25% of the way from narrowest to widest");
    expect(splitterValueText(200, bounds, "vertical", false)).toBe("Narrowest");
    expect(splitterValueText(360, bounds, "vertical", false)).toBe("Widest");
    expect(splitterValueText(201, bounds, "vertical", false)).toBe("1% of the way from narrowest to widest");
    expect(splitterValueText(359, bounds, "vertical", false)).toBe("99% of the way from narrowest to widest");
    expect(splitterValueText(118, { min: 36, max: 200 }, "horizontal", false)).toBe(
      "50% of the way from shortest to tallest",
    );
    expect(splitterValueText(200, { min: 36, max: 200 }, "horizontal", false)).toBe("Tallest");
    expect(splitterValueText(240, bounds, "vertical", true)).toBe("Collapsed");
    expect(splitterValueText(240, { min: 240, max: 240 }, "vertical", false)).toBe("Narrowest");
  });
});
