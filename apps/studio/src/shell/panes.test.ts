import { describe, expect, test } from "bun:test";
import { initialSession } from "@/contracts";
import { tierForWidth } from "./layout-tier";
import {
  consoleMax, hidePane, paneShowing, paneVisibility, showPane, togglePane, type Panes,
} from "./panes";

const fresh = (): Panes => initialSession().panes;

describe("tiers", () => {
  test("follow the spec's widths", () => {
    expect([1440, 1280, 1279, 1100, 1024, 1023, 900, 768, 767, 600, 320].map(tierForWidth)).toEqual([
      "wide", "wide", "mid", "mid", "mid", "narrow", "narrow", "narrow", "phone", "phone", "phone",
    ]);
  });
});

describe("pane visibility", () => {
  test("1280 px and wider shows every pane side by side", () => {
    expect(paneVisibility(fresh(), "wide")).toEqual({
      left: true, sheet: true, inspector: true, console: "body", drawers: false,
    });
  });

  test("768-1279 px shows no drawer until one is opened, then only that one", () => {
    for (const tier of ["mid", "narrow"] as const) {
      expect(paneVisibility(fresh(), tier)).toMatchObject({ left: false, inspector: false, sheet: true, drawers: true });
      const left = showPane(fresh(), tier, "catalog");
      expect(paneVisibility(left, tier)).toMatchObject({ left: true, inspector: false });
      const inspector = showPane(left, tier, "inspector");
      expect(paneVisibility(inspector, tier)).toMatchObject({ left: false, inspector: true });
    }
  });

  test("under 768 px one pane fills the window", () => {
    const panes = fresh();
    expect(paneVisibility(panes, "phone")).toEqual({
      left: false, sheet: true, inspector: false, console: "hidden", drawers: false,
    });
    expect(paneVisibility(showPane(panes, "phone", "console"), "phone")).toEqual({
      left: false, sheet: false, inspector: false, console: "full", drawers: false,
    });
    const structure = showPane(panes, "phone", "structure");
    expect(structure.left.tab).toBe("structure");
    expect(paneVisibility(structure, "phone")).toMatchObject({ left: true, sheet: false });
  });

  test("a maximized console covers the other panes without closing them", () => {
    const panes = { ...fresh(), console: { ...fresh().console, maximized: true } };
    expect(paneVisibility(panes, "wide")).toEqual({
      left: false, sheet: false, inspector: false, console: "full", drawers: false,
    });
    const shown = showPane(panes, "wide", "sheet");
    expect(shown.console.maximized).toBe(false);
    expect(shown.left.open).toBe(true);
  });
});

describe("show and toggle", () => {
  test("show returns the same object when the pane already shows", () => {
    const panes = fresh();
    expect(showPane(panes, "wide", "catalog")).toBe(panes);
    expect(showPane(panes, "wide", "sheet")).toBe(panes);
    expect(showPane(panes, "phone", "sheet")).toBe(panes);
  });

  test("show switches the left pane's tab", () => {
    const next = showPane(fresh(), "wide", "structure");
    expect(next.left).toMatchObject({ open: true, tab: "structure" });
    expect(paneShowing(next, "wide", "catalog")).toBe(false);
  });

  test("toggle hides and shows at every tier", () => {
    for (const tier of ["wide", "mid", "narrow", "phone"] as const) {
      const shown = togglePane(fresh(), tier, "inspector");
      const inspectorShows = paneShowing(shown, tier, "inspector");
      const back = togglePane(shown, tier, "inspector");
      expect(paneShowing(back, tier, "inspector")).toBe(!inspectorShows);
    }
    const hidden = togglePane(fresh(), "wide", "left");
    expect(hidden.left.open).toBe(false);
    expect(togglePane(hidden, "wide", "left").left.open).toBe(true);
  });

  test("hiding the console leaves its header; under 768 px it goes back to the sheet", () => {
    expect(paneVisibility(hidePane(fresh(), "wide", "console"), "wide").console).toBe("header");
    const phone = showPane(fresh(), "phone", "console");
    expect(hidePane(phone, "phone", "console").narrow).toBe("sheet");
  });

  test("pane changes never touch sizes or anything else in the session", () => {
    const panes = fresh();
    const next = togglePane(showPane(panes, "mid", "inspector"), "mid", "left");
    expect(next.left.size).toBe(panes.left.size);
    expect(next.inspector.size).toBe(panes.inspector.size);
    expect(next.console).toEqual(panes.console);
  });
});

describe("console height", () => {
  test("resizes to half the window's height, never below its default body", () => {
    expect(consoleMax(900)).toBe(414);
    expect(consoleMax(200)).toBe(124);
  });
});
