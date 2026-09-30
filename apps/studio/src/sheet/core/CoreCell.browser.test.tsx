/**
 * The core cell on the real sheet (the pinned diamond core): its rows and their names, the empty sheet's hint, the
 * cut row's states, every way to select and deselect the core, what selecting lights and stamps, the pads' hover
 * and focus, the keyboard (one Tab stop after the title block, arrows, Home and End; the sheet's own keys inert),
 * the collapse, the phone and narrow tiers, the catalog drop it refuses, Locate on a core facet, and the Back to
 * content lift (D16).
 */
import { coreStatus, placeFacet } from "@lattice-studio/core";
import { afterEach, describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { commandState, doc, getAnalysis, runCommand, session, startCatalogDrag } from "@/contracts";
import { bufferedServices, fixtureCatalog } from "../../../test/harness";
import { ensureVisible } from "../canvas/sheet-view";
import { drawn } from "../canvas/testing/sheet-harness";
import { stampText, planIndex } from "../card/plan-index";
import {
  announced, cardNode, clickCard, client, flowElement, layoutNow, position, press, selection,
} from "../interact/testing/interact-harness";
import { DROP_REFUSED, EMPTY_HINT } from "./copy";
import { cell, cellRow, clickPane, coreProject, glyphOf, pad, renderCoreSheet, stampOf, traceOf } from "./testing/core-harness";

const ID = "core-cell";
const VIEW = { session: { viewports: { [ID]: { x: 0, y: 0, zoom: 1 } } } };
const RECEIVE = "0x00000000";
const catalog = fixtureCatalog();

function status() {
  return coreStatus(doc.get().recipe, catalog, getAnalysis());
}

function flow(): HTMLElement {
  return flowElement();
}

afterEach(async () => {
  await page.viewport(1440, 900);
});

describe("the cell", () => {
  test("sits beside the title block as one toolbar whose rows carry their state", async () => {
    await renderCoreSheet({ project: coreProject(["ERC20", "SafeDiamondCut"], { id: ID }), ...VIEW });
    const toolbar = page.getByRole("toolbar", { name: "Core" });
    await expect.element(toolbar).toBeVisible();
    expect(cell().getAttribute("data-keyctx")).toBe("global");
    const s = status();
    expect(cellRow("Core: the diamond's fixed part")).toBeTruthy();
    expect(cellRow(`Fallback: ${s.fallback.routed} routed`).textContent).toContain(`${s.fallback.routed} routed`);
    expect(cellRow("Loupe socket: 4 of 4 covered").textContent).toContain("4/4");
    expect(cellRow("ERC-165 socket: covered")).toBeTruthy();
    expect(cellRow("Cut socket: SafeDiamondCut · upgradeable").textContent).toContain("SafeDiamondCut · upgradeable");
    expect(cellRow("Collapse the core cell")).toBeTruthy();
    // Every loupe pad is filled, and so is the cut socket's.
    expect([...cellRow(/^Loupe/).querySelectorAll("[data-on]")]).toHaveLength(4);
    expect(pad("cut").hasAttribute("data-on")).toBe(true);
    // Beside the title block: the cell ends a grid step before it, and the two share their bottom edge.
    const title = document.querySelector('[data-chrome="title-block"]');
    if (!title) throw new Error("No title block.");
    const t = title.getBoundingClientRect();
    const c = cell().getBoundingClientRect();
    expect(Math.abs(c.right + 8 - t.left)).toBeLessThan(2);
    expect(Math.abs(c.bottom - t.bottom)).toBeLessThan(2);
    expect(Math.round(c.width)).toBe(290);
    expect(Math.abs(c.height - 100)).toBeLessThan(4);
    // After the title block in the DOM, so after it in Tab order; one Tab stop (roving focus inside).
    expect(title.compareDocumentPosition(cell()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect([...cell().querySelectorAll("button")].filter((b) => b.tabIndex === 0)).toHaveLength(1);
  });

  test("an empty sheet shows the cell with its hint beside the Start block", async () => {
    await renderCoreSheet({ project: coreProject([], { id: ID }), ...VIEW });
    expect(cell().textContent).toContain(EMPTY_HINT);
    await expect.element(page.getByRole("heading", { name: "Start a diamond" })).toBeVisible();
    const s = status();
    expect(cellRow(`Fallback: ${s.fallback.routed} routed`)).toBeTruthy();
    expect(cellRow("Cut socket: empty · no upgrade mechanism").textContent).toContain("Empty · no upgrade mechanism");
    expect(pad("cut").hasAttribute("data-on")).toBe(false);
  });

  test("the cut row: kept immutable, a placed variant, or two claiming it (hatched)", async () => {
    await renderCoreSheet({ project: coreProject(["ERC20"], { id: ID, immutable: true }), ...VIEW });
    expect(cellRow("Cut socket: empty · immutable").textContent).toContain("Empty · immutable");
    doc.load(coreProject(["ERC20", "SafeDiamondCut", "GovernedDiamondCut"], { id: ID }));
    await expect.poll(() => cellRow(/^Cut socket/).getAttribute("data-cut")).toBe("conflict");
    // The first in catalog order holds the socket, whatever the placement order; the other is its rival.
    const conflict = cellRow("Cut socket: GovernedDiamondCut · SafeDiamondCut, both claim it");
    expect(getComputedStyle(conflict).backgroundImage).toContain("repeating-linear-gradient");
    doc.load(coreProject(["ERC20", "GovernedDiamondCut"], { id: ID }));
    await expect.poll(() => cellRow(/^Cut socket/).getAttribute("data-cut")).toBe("one");
    expect(getComputedStyle(cellRow(/^Cut socket/)).backgroundImage).toBe("none");
  });
});

describe("selecting the core", () => {
  test("a click on the cell selects it: the card selection clears, the frame, every glyph and the stamps follow", async () => {
    const project = coreProject(["ERC20", "SafeDiamondCut", "Receive"], { id: ID, exclude: [RECEIVE] });
    await renderCoreSheet({ project, ...VIEW });
    clickCard("ERC20");
    expect(selection()).toEqual(["ERC20"]);
    await userEvent.click(cellRow(/^Fallback/));
    await expect.poll(() => session.get().coreSelected).toBe(true);
    expect(selection()).toEqual([]);
    expect(announced().at(-1)).toBe("Selected the core.");
    await expect.poll(() => cell().hasAttribute("data-selected")).toBe(true);
    expect(cellRow("Core: the diamond's fixed part").getAttribute("aria-pressed")).toBe("true");
    // The accent frame: the border and the outline take the accent token.
    const probe = document.createElement("span");
    probe.style.color = "var(--lx-accent)";
    document.body.append(probe);
    const accent = getComputedStyle(probe).color;
    probe.remove();
    await expect.poll(() => getComputedStyle(cell()).borderTopColor).toBe(accent);
    expect(getComputedStyle(cell()).outlineStyle).toBe("solid");
    expect(getComputedStyle(cell()).outlineColor).toBe(accent);
    expect(flow().hasAttribute("data-core-lit")).toBe(true);
    const plan = getAnalysis().plan;
    await expect.poll(() => stampOf("ERC20")?.textContent).toBe(stampText(planIndex(plan, "ERC20")));
    expect(stampOf("ERC20")?.textContent).toBe("02");
    expect(stampOf("SafeDiamondCut")?.textContent).toBe("03");
    // Receive's one selector is left out: it routes nothing, so it isn't cut.
    expect(stampOf("Receive")?.textContent).toBe("Not cut");
    expect(stampOf("Receive")?.hasAttribute("data-not-cut")).toBe(true);
    expect(glyphOf("Receive").dataset.ground).toBe("none");
  });

  test("Enter and Space on a row select it; Esc, a card click and a click on empty sheet deselect it", async () => {
    await renderCoreSheet({ project: coreProject(["ERC20", "ERC4626"], { id: ID }), ...VIEW });
    const diamond = cellRow("Core: the diamond's fixed part");
    diamond.focus();
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => session.get().coreSelected).toBe(true);
    press("Escape");
    await expect.poll(() => session.get().coreSelected).toBe(false);
    await expect.poll(() => cell().hasAttribute("data-selected")).toBe(false);
    await expect.poll(() => flow().hasAttribute("data-core-lit")).toBe(false);
    expect(stampOf("ERC20")).toBeNull();

    diamond.focus();
    await userEvent.keyboard(" ");
    await expect.poll(() => session.get().coreSelected).toBe(true);
    clickCard("ERC4626");
    await expect.poll(() => session.get().coreSelected).toBe(false);
    expect(selection()).toEqual(["ERC4626"]);

    await userEvent.click(cellRow(/^Cut socket/));
    await expect.poll(() => session.get().coreSelected).toBe(true);
    expect(selection()).toEqual([]);
    clickPane({ x: 500, y: 450 });
    await expect.poll(() => session.get().coreSelected).toBe(false);
  });

  test("Locate on a core facet selects the core instead of centering a card", async () => {
    await renderCoreSheet({ project: coreProject(["ERC20"], { id: ID }), ...VIEW });
    expect(commandState({ id: "sheet.locate", args: { facet: "ERC165Facet" } }).ok).toBe(true);
    await runCommand({ id: "sheet.locate", args: { facet: "DiamondLoupeFacet" } }, "palette");
    await expect.poll(() => session.get().coreSelected).toBe(true);
    expect(selection()).toEqual([]);
  });
});

describe("the pads", () => {
  test("FALLBACK hovered or focused lights every glyph; CUT lights the cut card and draws its trace", async () => {
    await renderCoreSheet({ project: coreProject(["ERC20", "SafeDiamondCut"], { id: ID }), ...VIEW });
    const rest = getComputedStyle(glyphOf("ERC20")).color;
    await userEvent.hover(cellRow(/^Fallback/));
    await expect.poll(() => flow().hasAttribute("data-core-lit")).toBe(true);
    await expect.poll(() => getComputedStyle(glyphOf("ERC20")).color).not.toBe(rest);
    expect(pad("fallback").dataset.tone).toBe("soft");
    await userEvent.unhover(cellRow(/^Fallback/));
    await expect.poll(() => flow().hasAttribute("data-core-lit")).toBe(false);
    await expect.poll(() => getComputedStyle(glyphOf("ERC20")).color).toBe(rest);

    cellRow(/^Fallback/).focus();
    await expect.poll(() => flow().hasAttribute("data-core-lit")).toBe(true);
    cellRow(/^Fallback/).blur();
    await expect.poll(() => flow().hasAttribute("data-core-lit")).toBe(false);

    await userEvent.hover(cellRow(/^Cut socket/));
    await expect.poll(() => flow().hasAttribute("data-core-cut-lit")).toBe(true);
    await expect.poll(() => traceOf("SafeDiamondCut")?.dataset.tone).toBe("soft");
    expect(traceOf("SafeDiamondCut")?.dataset.to).toBe("cut");
    expect(traceOf("ERC20")).toBeNull();
    await expect.poll(() => getComputedStyle(glyphOf("SafeDiamondCut")).color).not.toBe(rest);
    await expect.poll(() => getComputedStyle(glyphOf("ERC20")).color).toBe(rest);
    expect(pad("cut").dataset.tone).toBe("soft");
    await userEvent.unhover(cellRow(/^Cut socket/));
    await expect.poll(() => traceOf("SafeDiamondCut")).toBeNull();
  });
});

describe("the keyboard", () => {
  test("Tab reaches the cell after the title block; the arrows, Home and End move between its rows", async () => {
    await renderCoreSheet({ project: coreProject(["ERC20"], { id: ID }), ...VIEW });
    const toggle = document.querySelector<HTMLElement>("[data-title-toggle]");
    if (!toggle) throw new Error("No title block toggle.");
    toggle.focus();
    let before: Element | null = null;
    for (let i = 0; i < 12 && !cell().contains(document.activeElement); i++) {
      before = document.activeElement;
      await userEvent.tab();
    }
    expect(cell().contains(document.activeElement)).toBe(true);
    expect(before?.closest('[data-chrome="title-block"]')).not.toBeNull();
    expect(document.activeElement).toBe(cellRow("Core: the diamond's fixed part"));
    await userEvent.keyboard("{ArrowDown}");
    await expect.poll(() => document.activeElement).toBe(cellRow("Collapse the core cell"));
    await userEvent.keyboard("{ArrowDown}");
    await expect.poll(() => document.activeElement).toBe(cellRow(/^Fallback/));
    await userEvent.keyboard("{End}");
    await expect.poll(() => document.activeElement).toBe(cellRow(/^Cut socket/));
    await userEvent.keyboard("{Home}");
    await expect.poll(() => document.activeElement).toBe(cellRow("Core: the diamond's fixed part"));
    await userEvent.keyboard("{ArrowUp}");
    await expect.poll(() => document.activeElement).toBe(cellRow(/^Cut socket/));
    // Tab leaves the cell: no trap.
    await userEvent.tab();
    expect(cell().contains(document.activeElement)).toBe(false);
  });

  test("Delete, cut and the nudges never reach the cards from the cell", async () => {
    await renderCoreSheet({ project: coreProject(["ERC20", "ERC4626"], { id: ID }), ...VIEW });
    clickCard("ERC20");
    const at = position("ERC20");
    cellRow(/^Fallback/).focus();
    press("Delete");
    press("Backspace");
    press("x", { metaKey: true });
    press("ArrowRight");
    press("ArrowRight", { shiftKey: true });
    press("a", { metaKey: true });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(layoutNow()["ERC20"]).toBeDefined();
    expect(position("ERC20")).toEqual(at);
    expect(selection()).toEqual(["ERC20"]);
    expect(doc.state().canUndo).toBe(false);
  });
});

describe("the collapse", () => {
  test("the chevron folds the cell to one line and back, kept in the session", async () => {
    await renderCoreSheet({ project: coreProject(["ERC20", "SafeDiamondCut"], { id: ID }), ...VIEW });
    await userEvent.click(cellRow("Collapse the core cell"));
    await expect.poll(() => session.get().panes.core.collapsed).toBe(true);
    await expect.poll(() => cell().hasAttribute("data-collapsed")).toBe(true);
    expect(cell().getBoundingClientRect().height).toBeLessThan(40);
    expect(session.get().coreSelected).toBe(false);
    // The rows stay, so do the pads: a trace still has somewhere to end.
    expect(cellRow(/^Fallback/)).toBeTruthy();
    expect(pad("fallback")).toBeTruthy();
    expect(pad("cut")).toBeTruthy();
    expect(cell().textContent).not.toContain("The diamond's fixed part");
    await userEvent.click(cellRow("Expand the core cell"));
    await expect.poll(() => session.get().panes.core.collapsed).toBe(false);
    expect(cell().getBoundingClientRect().height).toBeGreaterThan(90);
  });
});

describe("tiers", () => {
  test("under 768 px there is no cell and no trace, but the glyphs stay; from 768 px the cell is back", async () => {
    await renderCoreSheet({ project: coreProject(["ERC20"], { id: ID }), ...VIEW });
    await page.viewport(600, 900);
    await expect.poll(() => document.querySelector("[data-core-cell]")).toBeNull();
    expect(document.querySelector("[data-core-traces]")).toBeNull();
    expect(glyphOf("ERC20")).toBeTruthy();
    await userEvent.hover(cardNode("ERC20"));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(traceOf("ERC20")).toBeNull();
    await userEvent.unhover(cardNode("ERC20"));
    await page.viewport(900, 900);
    await expect.poll(() => document.querySelector("[data-core-cell]")).not.toBeNull();
    expect(document.querySelector("[data-core-traces]")).not.toBeNull();
  });
});

describe("a catalog drop", () => {
  test("over the cell shows no ghost, places nothing and says why", async () => {
    await renderCoreSheet({ project: coreProject(["ERC20"], { id: ID }), ...VIEW });
    const box = cell().getBoundingClientRect();
    const sheet = flow().getBoundingClientRect();
    const inside = { x: box.left - sheet.left + box.width / 2, y: box.top - sheet.top + box.height / 2 };
    const pointer = (type: "pointermove" | "pointerup", at: { clientX: number; clientY: number }) =>
      window.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 11, pointerType: "mouse", isPrimary: true, ...at }));
    startCatalogDrag("Pausable", { pointerId: 11, ...client({ x: -100, y: 300 }) });
    pointer("pointermove", client({ x: 600, y: 300 }));
    await expect.poll(() => document.querySelector("[data-drop-ghost]")).not.toBeNull();
    pointer("pointermove", client(inside));
    await expect.poll(() => document.querySelector("[data-drop-ghost]")).toBeNull();
    pointer("pointerup", client(inside));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(layoutNow()["Pausable"]).toBeUndefined();
    expect(bufferedServices().log.at(-1)?.text).toBe(DROP_REFUSED);
    expect(announced().at(-1)).toBe(DROP_REFUSED);
    // A drop beside the cell still places the card.
    startCatalogDrag("Pausable", { pointerId: 12, ...client({ x: -100, y: 300 }) });
    window.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 12, pointerType: "mouse", isPrimary: true, ...client({ x: 600, y: 300 }) }));
    window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 12, pointerType: "mouse", isPrimary: true, ...client({ x: 600, y: 300 }) }));
    await expect.poll(() => layoutNow()["Pausable"]).toBeDefined();
  });
});

describe("auto-pan", () => {
  test("a focused card that fits pans clear of the cell, as of every float (2.4.11)", async () => {
    const project = coreProject(["Pausable"], { id: ID });
    // Under the cell: the cell sits at the sheet's bottom, from x 361 in a 1000 px sheet.
    project.layout["Pausable"] = { x: 400, y: 480, pins: "left" };
    await renderCoreSheet({ project, ...VIEW });
    const overlap = (a: DOMRect, b: DOMRect) =>
      Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    expect(overlap(cardNode("Pausable").getBoundingClientRect(), cell().getBoundingClientRect())).toBeGreaterThan(0);
    expect(ensureVisible("Pausable")).toBe(true);
    await drawn();
    await expect.poll(() => overlap(cardNode("Pausable").getBoundingClientRect(), cell().getBoundingClientRect())).toBe(0);
    const sheet = flow().getBoundingClientRect();
    const card = cardNode("Pausable").getBoundingClientRect();
    expect(card.left >= sheet.left && card.right <= sheet.right && card.top >= sheet.top && card.bottom <= sheet.bottom).toBe(true);
  });
});

describe("Back to content (D16)", () => {
  test("lifts by the cell's height where it would sit under the cell", async () => {
    await renderCoreSheet({ project: coreProject(["ERC20"], { id: ID }), ...VIEW });
    const height = Math.ceil(cell().getBoundingClientRect().height);
    // A 1000 px sheet: the cell's left edge lies inside Back to content's column, so it lifts.
    await expect.poll(() => flow().style.getPropertyValue("--lx-core-lift")).toBe(`${height + 8}px`);
    // Placing through the document keeps the lift in step with the cell's height.
    doc.apply("Placed", (p) => placeFacet(p, catalog, "ERC4626", { x: 400, y: 24 }));
    await expect.poll(() => flow().style.getPropertyValue("--lx-core-lift")).toBe(`${Math.ceil(cell().getBoundingClientRect().height) + 8}px`);
  });
});
