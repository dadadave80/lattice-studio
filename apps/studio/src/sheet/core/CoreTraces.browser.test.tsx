/**
 * The traces into the core on the real sheet: none at rest; one ink wire on hover or keyboard focus, from the
 * glyph down the gutter, along the rail and into the FALLBACK pad (the cut facet's into CUT); the selection's
 * wires live with a stub and a junction dot per routed row, select-all combing every card; a card that routes
 * nothing never draws one; a placed card's wire flashes and goes away (with reduced motion too); and the wires
 * follow a pan and a drag.
 */
import { placeFacet } from "@lattice-studio/core";
import { describe, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { doc, getAnalysis } from "@/contracts";
import { fixtureCatalog } from "../../../test/harness";
import { panSheet } from "../canvas/sheet-view";
import { drawn } from "../canvas/testing/sheet-harness";
import { cardNode, clickCard, dragCard, press, selection } from "../interact/testing/interact-harness";
import { GLYPH_LEAD, GUTTER, RAIL_GAP } from "./geometry";
import { cell, coreProject, glyphOf, pad, padTone, rectIn, renderCoreSheet, traceOf, traces, wireOf } from "./testing/core-harness";

const ID = "core-traces";
const VIEW = { session: { viewports: { [ID]: { x: 0, y: 0, zoom: 1 } } } };
const RECEIVE = "0x00000000";
const FACETS = ["ERC20", "ERC4626", "SafeDiamondCut", "Receive"];
const catalog = fixtureCatalog();

function routedBy(facet: string): number {
  return Object.values(getAnalysis().routing).filter((route) => route.owner === facet).length;
}

/** The wire's geometry a card's trace should have now. */
function expectedWire(facet: string, to: "fallback" | "cut") {
  const card = rectIn(cardNode(facet));
  const side = doc.get().layout[facet]?.pins === "right" ? "right" : "left";
  const anchorX = side === "right" ? card.right : card.left;
  const padBox = rectIn(pad(to));
  return {
    start: { x: anchorX, y: card.bottom + GLYPH_LEAD },
    gutter: side === "right" ? card.right + GUTTER : card.left - GUTTER,
    rail: rectIn(cell()).top - RAIL_GAP,
    pad: { x: padBox.left + padBox.width / 2, y: padBox.top },
  };
}

function close(a: number, b: number): void {
  expect(Math.abs(a - b)).toBeLessThan(1);
}

function expectWire(trace: SVGGElement, facet: string, to: "fallback" | "cut"): void {
  const wire = wireOf(trace);
  const want = expectedWire(facet, to);
  close(wire.start.x, want.start.x);
  close(wire.start.y, want.start.y);
  close(wire.gutter, want.gutter);
  close(wire.rail, want.rail);
  close(wire.pad.x, want.pad.x);
  close(wire.pad.y, want.pad.y);
}

async function sheet(options: { exclude?: `0x${string}`[]; reduceMotion?: "on" | "off" } = {}) {
  const project = coreProject(FACETS, { id: ID, ...(options.exclude ? { exclude: options.exclude } : {}) });
  await renderCoreSheet({ project, ...VIEW, settings: { reduceMotion: options.reduceMotion ?? "on" } });
  expect(traces()).toEqual([]);
  return project;
}

describe("hover and focus", () => {
  test("hovering a card draws one ink wire from its glyph into the FALLBACK pad; leaving removes it", async () => {
    await sheet();
    await userEvent.hover(cardNode("ERC20"));
    await expect.poll(() => traceOf("ERC20")).not.toBeNull();
    const trace = traceOf("ERC20");
    if (!trace) throw new Error("No trace.");
    expect(trace.dataset.tone).toBe("soft");
    expect(trace.dataset.to).toBe("fallback");
    await expect.poll(() => trace.querySelector("path")?.getAttribute("d")).toMatch(/^M/);
    expectWire(trace, "ERC20", "fallback");
    expect(trace.querySelectorAll("circle")).toHaveLength(0);
    expect(padTone("fallback")).toBe("soft");
    expect(traces()).toHaveLength(1);
    await userEvent.unhover(cardNode("ERC20"));
    await expect.poll(() => traceOf("ERC20")).toBeNull();
    expect(padTone("fallback")).toBeNull();
  });

  test("keyboard focus on a card draws its wire; the cut facet's wire ends on the CUT pad", async () => {
    await sheet();
    // A key press first, so the focus that follows is the keyboard's (:focus-visible), as roving focus is.
    await userEvent.keyboard("{Shift}");
    cardNode("SafeDiamondCut").focus();
    expect(cardNode("SafeDiamondCut").matches(":focus-visible")).toBe(true);
    await expect.poll(() => traceOf("SafeDiamondCut")).not.toBeNull();
    const trace = traceOf("SafeDiamondCut");
    if (!trace) throw new Error("No trace.");
    expect(trace.dataset.to).toBe("cut");
    await expect.poll(() => trace.querySelector("path")?.getAttribute("d")).toMatch(/^M/);
    expectWire(trace, "SafeDiamondCut", "cut");
    expect(padTone("cut")).toBe("soft");
    expect(padTone("fallback")).toBeNull();
    cardNode("SafeDiamondCut").blur();
    await expect.poll(() => traceOf("SafeDiamondCut")).toBeNull();
  });

  test("a card a click focused draws nothing once it's deselected: only keyboard focus draws a wire", async () => {
    await sheet();
    await userEvent.click(cardNode("ERC4626"), { position: { x: 40, y: 12 } });
    await expect.poll(() => traceOf("ERC4626")?.dataset.tone).toBe("live");
    press("Escape");
    await expect.poll(() => selection()).toEqual([]);
    // The pointer is still over the card: park it on empty sheet, and the wire goes though the card keeps focus.
    await userEvent.hover(document.querySelector<HTMLElement>(".react-flow__pane") as HTMLElement, { position: { x: 300, y: 690 } });
    expect(cardNode("ERC4626").contains(document.activeElement)).toBe(true);
    await expect.poll(() => traceOf("ERC4626")).toBeNull();
  });

  test("a card that routes nothing never draws a wire", async () => {
    await sheet({ exclude: [RECEIVE] });
    expect(glyphOf("Receive").dataset.ground).toBe("none");
    await userEvent.hover(cardNode("Receive"));
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(traceOf("Receive")).toBeNull();
    cardNode("Receive").focus();
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(traceOf("Receive")).toBeNull();
    await userEvent.unhover(cardNode("Receive"));
  });
});

describe("selection", () => {
  test("a selected card's wire is live, with a stub and a junction dot per routed row", async () => {
    await sheet();
    clickCard("ERC20");
    await expect.poll(() => traceOf("ERC20")?.dataset.tone).toBe("live");
    const trace = traceOf("ERC20");
    if (!trace) throw new Error("No trace.");
    // ERC20's nine rows all draw (at the collapse threshold); one is served by ERC4626.
    const routed = routedBy("ERC20");
    expect(routed).toBeLessThan(9);
    await expect.poll(() => trace.querySelectorAll("circle").length).toBe(routed);
    // The painter writes the geometry on the next frame: one stub run into the gutter per routed row.
    await expect.poll(() => (trace.querySelectorAll("path")[1]?.getAttribute("d") ?? "").split("H")).toHaveLength(routed + 1);
    await expect.poll(() => trace.querySelector("circle")?.getAttribute("r")).toBe("2.5");
    expect(padTone("fallback")).toBe("live");
    const glyph = glyphOf("ERC20");
    expect(glyph.hasAttribute("data-live")).toBe(true);
    press("Escape");
    await expect.poll(() => traceOf("ERC20")).toBeNull();
  });

  test("select-all combs every routed card along the rail", async () => {
    await sheet();
    clickCard("ERC20");
    cardNode("ERC20").focus();
    press("a", { metaKey: true });
    await expect.poll(() => selection().length).toBe(FACETS.length);
    await expect.poll(() => traces().filter((t) => t.dataset.tone === "live").length).toBe(FACETS.length);
    await expect.poll(() => traces().every((t) => t.querySelector("path")?.getAttribute("d"))).toBe(true);
    const rails = new Set(traces().map((t) => wireOf(t).rail));
    expect(rails.size).toBe(1);
    expect(traces().filter((t) => t.dataset.to === "cut")).toHaveLength(1);
  });
});

describe("placement", () => {
  test("a placed card's wire flashes in the accent, then goes; with reduced motion nothing animates", async () => {
    await sheet();
    doc.apply("Placed Pausable", (p) => placeFacet(p, catalog, "Pausable", { x: 24 + 4 * 272, y: 24 }));
    await expect.poll(() => traceOf("Pausable")?.dataset.tone).toBe("flash");
    const trace = traceOf("Pausable");
    if (!trace) throw new Error("No trace.");
    expect(getComputedStyle(trace).animationName).toBe("none");
    await expect.poll(() => traceOf("Pausable"), { timeout: 3000 }).toBeNull();
  });

  test("with full motion the flash fades", async () => {
    await sheet({ reduceMotion: "off" });
    doc.apply("Placed Pausable", (p) => placeFacet(p, catalog, "Pausable", { x: 24 + 4 * 272, y: 24 }));
    await expect.poll(() => traceOf("Pausable")?.dataset.tone).toBe("flash");
    const trace = traceOf("Pausable");
    if (!trace) throw new Error("No trace.");
    expect(getComputedStyle(trace).animationName).toMatch(/core-flash/);
    await expect.poll(() => traceOf("Pausable"), { timeout: 3000 }).toBeNull();
  });
});

describe("following the view", () => {
  test("a wire follows a pan and a drag", async () => {
    await sheet();
    clickCard("ERC4626");
    await expect.poll(() => traceOf("ERC4626")?.dataset.tone).toBe("live");
    const trace = traceOf("ERC4626");
    if (!trace) throw new Error("No trace.");
    await expect.poll(() => trace.querySelector("path")?.getAttribute("d")).toMatch(/^M/);
    const before = wireOf(trace);
    panSheet(-50, -30);
    await drawn();
    await expect.poll(() => wireOf(trace).start.x).toBeCloseTo(before.start.x - 50, 0);
    expect(wireOf(trace).start.y).toBeCloseTo(before.start.y - 30, 0);
    // The rail and the pad are screen space: they stay.
    expect(wireOf(trace).rail).toBe(before.rail);
    expect(wireOf(trace).pad).toEqual(before.pad);
    expectWire(trace, "ERC4626", "fallback");

    const moved = wireOf(trace);
    await dragCard("ERC4626", { x: 64, y: 40 });
    await expect.poll(() => wireOf(trace).start.x).not.toBe(moved.start.x);
    expectWire(trace, "ERC4626", "fallback");
  });
});
