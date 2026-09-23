import { describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import {
  commandState, doc, provideServices, runCommand, session, settings, type ProjectsService, type Viewport,
} from "@/contracts";
import { bufferedServices } from "@/contracts/services";
import { focusCard } from "@/a11y/focus";
import { runConsoleLine } from "@/commands/console/router";
import { installShortcuts } from "@/commands/keys/dispatcher";
import { fixtureCatalog, onCleanup } from "../../../test/harness";
import { cardProject } from "../card/testing/projects";
import { BACK_TO_CONTENT_DELAY_MS } from "./BackToContent";
import { ensureVisible, sheetViewport } from "./sheet-view";
import {
  cardNode, cardScreenRect, drag, drawn, drawnViewport, emptyProject, flowElement, key, paneElement, renderSheet, settled,
  SHEET_HEIGHT, SHEET_WIDTH, sheetProject, storedViewport, wheel,
} from "./testing/sheet-harness";
import { FIT_MAX_ZOOM, MAX_ZOOM, MIN_ZOOM } from "./viewport-math";

/** A projects service that keeps viewports in a map, as S7a keeps them in IndexedDB. */
function storedViewports(saved = new Map<string, Viewport>()): Map<string, Viewport> {
  const projects: ProjectsService = {
    createProject: () => Promise.reject(new Error("not in this test")),
    openProject: () => Promise.reject(new Error("not in this test")),
    saveStatus: () => ({ state: "saved", text: "Saved" }),
    subscribeSaveStatus: () => () => undefined,
    loadViewport: (id) => Promise.resolve(saved.get(id) ?? null),
    saveViewport: (id, viewport) => void saved.set(id, viewport),
  };
  onCleanup(provideServices({ projects }));
  return saved;
}

function close(a: Viewport, b: Viewport | undefined): boolean {
  return !!b && Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1 && Math.abs(a.zoom - b.zoom) < 1e-3;
}

describe("the sheet", () => {
  test("is React Flow's application, labelled, with one Tab stop in the card grid", async () => {
    const project = sheetProject(6);
    await renderSheet({ project });
    const app = page.getByRole("application", { name: "Diamond sheet" });
    await expect.element(app).toBeInTheDocument();
    expect(flowElement().closest("[data-keyctx]")?.getAttribute("data-keyctx")).toBe("sheet");
    const nodes = [...document.querySelectorAll<HTMLElement>(".react-flow__node[data-id]")];
    expect(nodes).toHaveLength(6);
    expect(nodes.filter((n) => n.tabIndex === 0)).toHaveLength(1);
    expect(nodes.every((n) => n.getAttribute("aria-roledescription") === "facet card")).toBe(true);
    // No attribution link, and React Flow's keyboard layer and its live messages are off (spec L752).
    expect(document.querySelector(".react-flow__attribution")).toBeNull();
    expect(flowElement().querySelector("[aria-live]")).toBeNull();
    expect(nodes.every((n) => !n.getAttribute("aria-describedby")?.startsWith("react-flow__"))).toBe(true);
  });

  test("a project with no stored viewport opens fitted, and the fit is stored and saved", async () => {
    const saved = storedViewports();
    const project = sheetProject(8);
    await renderSheet({ project });
    const v = storedViewport();
    expect(v?.zoom).toBeLessThanOrEqual(FIT_MAX_ZOOM);
    expect(close(drawnViewport(), v)).toBe(true);
    expect(close(saved.get(project.id) ?? { x: NaN, y: NaN, zoom: NaN }, v)).toBe(true);
    for (const name of Object.keys(project.layout)) {
      const r = cardScreenRect(name);
      expect(r.left).toBeGreaterThanOrEqual(0);
      expect(r.right).toBeLessThanOrEqual(SHEET_WIDTH);
    }
  });

  test("survives a reload: the saved viewport comes back through loadViewport", async () => {
    const saved = storedViewports();
    const project = sheetProject(4);
    const first = await renderSheet({ project });
    await runCommand({ id: "sheet.zoomTo", args: { zoom: 0.5 } }, "palette");
    await expect.poll(() => saved.get(project.id)?.zoom).toBe(0.5);
    const left = saved.get(project.id);
    await first.unmount();

    // A new page: the session starts empty, storage still has it.
    session.set({ viewports: {} });
    await renderSheet({ project });
    expect(close(drawnViewport(), left)).toBe(true);
    expect(close(storedViewport() ?? { x: 0, y: 0, zoom: 0 }, left)).toBe(true);
  });

  test("project switches keep each project's own viewport", async () => {
    storedViewports();
    const a = sheetProject(4, { id: "a" });
    const b = sheetProject(10, { id: "b", columns: 5 });
    await renderSheet({ project: a });
    await runCommand({ id: "sheet.zoomTo", args: { zoom: 1.5 } }, "palette");
    const aView = sheetViewport();

    doc.load(b);
    await settled();
    const bView = sheetViewport();
    expect(close(bView, aView)).toBe(false);
    expect(session.get().viewports.a?.zoom).toBe(1.5);

    await runCommand({ id: "sheet.zoomTo", args: { zoom: 0.25 } }, "palette");
    doc.load(a);
    await settled();
    expect(close(drawnViewport(), aView)).toBe(true);
    doc.load(b);
    await settled();
    expect((await drawn()).zoom).toBeCloseTo(0.25);
  });

  test("a new empty project opens at the origin, not at the last project's view", async () => {
    await renderSheet({ project: sheetProject(4, { id: "full" }) });
    await runCommand({ id: "sheet.zoomTo", args: { zoom: 0.33 } }, "palette");
    doc.load(emptyProject("empty"));
    await settled();
    expect(drawnViewport()).toEqual({ x: 0, y: 0, zoom: 1 });
  });

  test("a viewport stored from elsewhere is followed", async () => {
    await renderSheet({ project: sheetProject(3) });
    session.set((s) => ({ viewports: { ...s.viewports, [doc.get().id]: { x: -120, y: -40, zoom: 0.5 } } }));
    await expect.poll(() => close(drawnViewport(), { x: -120, y: -40, zoom: 0.5 })).toBe(true);
  });
});

describe("pan", () => {
  test("the wheel pans by default and zooms with ⌘/Ctrl or a pinch, at the pointer", async () => {
    await renderSheet({ project: sheetProject(4) });
    const before = drawnViewport();
    wheel({ deltaY: 120, deltaX: 40 });
    await expect.poll(() => drawnViewport().y).toBeLessThan(before.y);
    expect(drawnViewport().x).toBeLessThan(before.x);
    expect(drawnViewport().zoom).toBeCloseTo(before.zoom);
    await expect.poll(() => storedViewport()?.y).toBeCloseTo(drawnViewport().y, 0);

    const at = { x: 200, y: 150 };
    const pinned = drawnViewport();
    const sheetPoint = { x: (at.x - pinned.x) / pinned.zoom, y: (at.y - pinned.y) / pinned.zoom };
    wheel({ deltaY: -100, ctrlKey: true, at });
    await expect.poll(() => drawnViewport().zoom).toBeGreaterThan(pinned.zoom);
    const after = drawnViewport();
    expect(at.x - sheetPoint.x * after.zoom).toBeCloseTo(after.x, 0);
    expect(at.y - sheetPoint.y * after.zoom).toBeCloseTo(after.y, 0);
  });

  test("with the wheel set to zoom, the wheel zooms", async () => {
    await renderSheet({ project: sheetProject(4), settings: { wheel: "zoom", reduceMotion: "on" } });
    const before = drawnViewport();
    wheel({ deltaY: -200 });
    await expect.poll(() => drawnViewport().zoom).toBeGreaterThan(before.zoom);
    settings.set({ wheel: "pan" });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const zoomed = drawnViewport();
    wheel({ deltaY: 200 });
    await expect.poll(() => drawnViewport().y).toBeLessThan(zoomed.y);
    expect(drawnViewport().zoom).toBeCloseTo(zoomed.zoom);
  });

  test("middle and right drags pan with the Select tool; a left drag on the pane doesn't", async () => {
    await renderSheet({ project: sheetProject(4) });
    const start = drawnViewport();
    await drag(paneElement(), { x: 900, y: 600 }, { x: -60, y: -30 }, 1);
    await expect.poll(() => drawnViewport().x).toBeCloseTo(start.x - 60, 0);
    const mid = drawnViewport();
    await drag(paneElement(), { x: 900, y: 600 }, { x: 40, y: 20 }, 2);
    await expect.poll(() => drawnViewport().x).toBeCloseTo(mid.x + 40, 0);
    const right = drawnViewport();
    await drag(paneElement(), { x: 900, y: 600 }, { x: 50, y: 50 }, 0);
    expect(drawnViewport()).toEqual(right);
  });

  test("the Hand tool (H) pans with a left drag, over cards too", async () => {
    const project = sheetProject(4);
    await renderSheet({ project });
    await runCommand({ id: "tool.hand" }, "keys");
    expect(session.get().tool).toBe("hand");
    expect(flowElement().closest("[data-tool]")?.getAttribute("data-tool")).toBe("hand");
    const start = drawnViewport();
    const card = cardNode(Object.keys(project.layout)[0] ?? "");
    const r = cardScreenRect(card.dataset.id ?? "");
    await drag(card, { x: r.x + 20, y: r.y + 10 }, { x: 70, y: 35 });
    await expect.poll(() => drawnViewport().x).toBeCloseTo(start.x + 70, 0);
    expect(doc.get().layout[card.dataset.id ?? ""]).toEqual(project.layout[card.dataset.id ?? ""]);
    await runCommand({ id: "tool.select" }, "keys");
    expect(session.get().tool).toBe("select");
  });

  test("Space held, then drag, pans; letting go ends it", async () => {
    await renderSheet({ project: sheetProject(4) });
    const wrapper = flowElement().closest<HTMLElement>("[data-tool]");
    if (!wrapper) throw new Error("no wrapper");
    wrapper.dispatchEvent(new PointerEvent("pointerenter"));
    key("keydown", " ");
    await expect.poll(() => wrapper.hasAttribute("data-panning")).toBe(true);
    const start = drawnViewport();
    await drag(paneElement(), { x: 900, y: 600 }, { x: -80, y: 0 });
    await expect.poll(() => drawnViewport().x).toBeCloseTo(start.x - 80, 0);
    key("keyup", " ");
    await expect.poll(() => wrapper.hasAttribute("data-panning")).toBe(false);
    const after = drawnViewport();
    await drag(paneElement(), { x: 900, y: 600 }, { x: -80, y: 0 });
    expect(drawnViewport()).toEqual(after);
  });

  test("Space in a text field or on a button types or presses; it never pans", async () => {
    await renderSheet({ project: sheetProject(2) });
    const wrapper = flowElement().closest<HTMLElement>("[data-tool]");
    const input = document.createElement("input");
    const button = document.createElement("button");
    document.body.append(input, button);
    onCleanup(() => {
      input.remove();
      button.remove();
    });
    wrapper?.dispatchEvent(new PointerEvent("pointerenter"));
    key("keydown", " ", input);
    key("keydown", " ", button);
    expect(wrapper?.hasAttribute("data-panning")).toBe(false);
  });
});

describe("zoom", () => {
  test("presets, 100%, bounds, and + and − at the center", async () => {
    await renderSheet({ project: sheetProject(4) });
    for (const zoom of [0.5, 1, 2]) {
      await runCommand({ id: "sheet.zoomTo", args: { zoom } }, "palette");
      expect((await drawn()).zoom).toBeCloseTo(zoom);
      expect(storedViewport()?.zoom).toBeCloseTo(zoom);
    }
    expect(commandState({ id: "sheet.zoomIn" })).toMatchObject({ ok: false, reason: "Already at 200%" });
    await runCommand({ id: "sheet.zoomTo", args: { zoom: 7 } }, "palette");
    expect((await drawn()).zoom).toBe(MAX_ZOOM);
    for (let i = 0; i < 6; i++) wheel({ deltaY: -400, ctrlKey: true });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(drawnViewport().zoom).toBeLessThanOrEqual(MAX_ZOOM + 1e-6);

    await runCommand({ id: "sheet.zoom100" }, "keys");
    const center = { x: SHEET_WIDTH / 2, y: SHEET_HEIGHT / 2 };
    const before = await drawn();
    const sheetCenter = { x: (center.x - before.x) / before.zoom, y: (center.y - before.y) / before.zoom };
    await runCommand({ id: "sheet.zoomIn" }, "keys");
    const after = await drawn();
    expect(after.zoom).toBeCloseTo(1.25);
    expect((center.x - after.x) / after.zoom).toBeCloseTo(sheetCenter.x, 0);
    expect((center.y - after.y) / after.zoom).toBeCloseTo(sheetCenter.y, 0);
    await runCommand({ id: "sheet.zoomOut" }, "keys");
    await drawn();
    await runCommand({ id: "sheet.zoomOut" }, "keys");
    expect((await drawn()).zoom).toBeCloseTo(0.75);

    await runCommand({ id: "sheet.zoomTo", args: { zoom: 0.1 } }, "palette");
    expect((await drawn()).zoom).toBe(MIN_ZOOM);
    await expect.poll(() => commandState({ id: "sheet.zoomOut" })).toMatchObject({ ok: false, reason: "Already at 10%" });
    for (let i = 0; i < 6; i++) wheel({ deltaY: 400, ctrlKey: true });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(drawnViewport().zoom).toBeGreaterThanOrEqual(MIN_ZOOM - 1e-6);
  });

  test("the keys: =, + and − zoom, ⇧0 is 100%, ⇧1 fits, ⇧2 frames the selection", async () => {
    onCleanup(installShortcuts());
    const project = sheetProject(6);
    await renderSheet({ project });
    const card = cardNode(Object.keys(project.layout)[0] ?? "");
    const press = (keyValue: string, code: string, shiftKey = false) =>
      card.dispatchEvent(new KeyboardEvent("keydown", { key: keyValue, code, shiftKey, bubbles: true, cancelable: true }));
    // ⇧0 types ")" on US QWERTY and "=" on QWERTZ: the physical key decides (spec L754).
    press(")", "Digit0", true);
    await expect.poll(() => drawnViewport().zoom).toBeCloseTo(1);
    press("=", "Equal");
    await expect.poll(() => drawnViewport().zoom).toBeCloseTo(1.25);
    press("+", "NumpadAdd");
    await expect.poll(() => drawnViewport().zoom).toBeCloseTo(1.5);
    press("-", "Minus");
    await expect.poll(() => drawnViewport().zoom).toBeCloseTo(1.25);
    press("=", "Digit0", true);
    await expect.poll(() => drawnViewport().zoom).toBeCloseTo(1);
    press("!", "Digit1", true);
    await expect.poll(() => drawnViewport().zoom).toBeLessThanOrEqual(FIT_MAX_ZOOM);
    const name = Object.keys(project.layout)[3] ?? "";
    session.set({ selection: [name] });
    press("@", "Digit2", true);
    await expect.poll(() => {
      const r = cardScreenRect(name);
      return Math.abs(r.x + r.width / 2 - SHEET_WIDTH / 2) < 2 && Math.abs(r.y + r.height / 2 - SHEET_HEIGHT / 2) < 40;
    }).toBe(true);
  });

  test("Fit and Zoom to selection say why when there's nothing to frame", async () => {
    await renderSheet({ project: emptyProject("e") });
    expect(commandState({ id: "sheet.zoomFit" })).toMatchObject({ ok: false, reason: "The sheet is empty" });
    expect(commandState({ id: "sheet.zoomSelection" })).toMatchObject({ ok: false, reason: "Select a card first" });
    await runCommand({ id: "sheet.zoom100" }, "keys");
    expect(bufferedServices().log.at(-1)?.text).toBe("Already at 100%.");
  });

  test("the console: zoom 75, zoom fit, zoom selection and fit", async () => {
    const project = sheetProject(4);
    await renderSheet({ project });
    await runConsoleLine("zoom 75");
    expect((await drawn()).zoom).toBeCloseTo(0.75);
    expect(bufferedServices().log.at(-1)?.text).toBe("Zoom 75%.");
    await runConsoleLine("zoom 500");
    expect(bufferedServices().log.at(-1)?.text).toBe("Type a percent from 10 to 200, fit or selection.");
    await runConsoleLine("zoom fit");
    expect(bufferedServices().log.at(-1)?.text).toMatch(/^Fit 4 cards · \d+%\.$/);
    session.set({ selection: [Object.keys(project.layout)[0] ?? ""] });
    await runConsoleLine("zoom selection");
    expect(bufferedServices().log.at(-1)?.text).toMatch(/^Zoomed to \w+ · \d+%\.$/);
    await runConsoleLine("fit");
    expect(bufferedServices().log.at(-1)?.text).toMatch(/^Fit 4 cards/);
  });

  test("glides, and jumps instead with reduced motion", async () => {
    await renderSheet({ project: sheetProject(4), settings: { reduceMotion: "off" } });
    const start = drawnViewport().zoom;
    await runCommand({ id: "sheet.zoomTo", args: { zoom: 2 } }, "palette");
    // A glide passes through the zooms between; its first frames are neither the start nor the end.
    const seen: number[] = [];
    await expect.poll(() => {
      seen.push(drawnViewport().zoom);
      return drawnViewport().zoom;
    }, { interval: 10 }).toBeCloseTo(2);
    expect(seen.some((z) => z > start + 0.01 && z < 2 - 0.01)).toBe(true);

    settings.set({ reduceMotion: "on" });
    await runCommand({ id: "sheet.zoomTo", args: { zoom: 0.5 } }, "palette");
    const frames: number[] = [];
    await expect.poll(() => {
      frames.push(drawnViewport().zoom);
      return drawnViewport().zoom;
    }, { interval: 10 }).toBeCloseTo(0.5);
    expect(frames.every((z) => Math.abs(z - 2) < 1e-3 || Math.abs(z - 0.5) < 1e-3)).toBe(true);
  });

  test("below 40% the cards draw compact", async () => {
    await renderSheet({ project: sheetProject(2) });
    await runCommand({ id: "sheet.zoomTo", args: { zoom: 0.33 } }, "palette");
    await expect.poll(() => document.querySelectorAll("[data-facet] [data-selector]").length).toBe(0);
    await runCommand({ id: "sheet.zoomTo", args: { zoom: 0.5 } }, "palette");
    await expect.poll(() => document.querySelectorAll("[data-facet] [data-selector]").length).toBeGreaterThan(0);
  });
});

describe("locate, Back to content, minimap, auto-pan", () => {
  test("sheet.locate selects the card and centers it at 75% or more", async () => {
    const project = sheetProject(12, { columns: 6 });
    await renderSheet({ project });
    await runCommand({ id: "sheet.zoomTo", args: { zoom: 0.25 } }, "palette");
    const name = Object.keys(project.layout).at(-1) ?? "";
    await runCommand({ id: "sheet.locate", args: { facet: name } }, "api");
    expect(session.get().selection).toEqual([name]);
    expect((await drawn()).zoom).toBeCloseTo(0.75);
    const r = cardScreenRect(name);
    expect(Math.abs(r.x + r.width / 2 - SHEET_WIDTH / 2)).toBeLessThan(2);
    await runCommand({ id: "sheet.zoomTo", args: { zoom: 1.5 } }, "palette");
    await drawn();
    await runCommand({ id: "sheet.locate", args: { facet: Object.keys(project.layout)[0] ?? "" } }, "api");
    expect((await drawn()).zoom).toBeCloseTo(1.5);
    expect(commandState({ id: "sheet.locate", args: { facet: "Nope" } })).toMatchObject({ ok: false, reason: "Nope isn't on the sheet." });
  });

  test("Back to content appears after 1 s with every card off-screen, and fits the view", async () => {
    const project = sheetProject(4);
    await renderSheet({ project });
    const button = page.getByRole("button", { name: "Back to content" });
    session.set((s) => ({ viewports: { ...s.viewports, [project.id]: { x: 20000, y: 20000, zoom: 1 } } }));
    await expect.poll(() => drawnViewport().x).toBe(20000);
    const gone = performance.now();
    await new Promise((resolve) => setTimeout(resolve, BACK_TO_CONTENT_DELAY_MS * 0.6));
    expect(document.querySelector("[data-back-to-content]")).toBeNull();
    await expect.element(button).toBeVisible();
    expect(performance.now() - gone).toBeGreaterThanOrEqual(BACK_TO_CONTENT_DELAY_MS - 50);

    (button.element() as HTMLElement).focus();
    await userEvent.keyboard("{Enter}");
    await expect.poll(() => document.querySelector("[data-back-to-content]")).toBeNull();
    for (const name of Object.keys(project.layout)) expect(cardScreenRect(name).right).toBeGreaterThan(0);
    // Focus stays on the sheet: the grid's Tab stop, not the page.
    await expect.poll(() => document.activeElement?.closest(".react-flow__node")).not.toBeNull();

    // One card peeking in: no button.
    session.set((s) => ({ viewports: { ...s.viewports, [project.id]: { x: SHEET_WIDTH - 40, y: 0, zoom: 1 } } }));
    await expect.poll(() => drawnViewport().x).toBe(SHEET_WIDTH - 40);
    await new Promise((resolve) => setTimeout(resolve, BACK_TO_CONTENT_DELAY_MS + 200));
    expect(document.querySelector("[data-back-to-content]")).toBeNull();
  });

  test("the minimap is off by default; on, a click there pans the sheet to that spot", async () => {
    const project = sheetProject(12, { columns: 6 });
    await renderSheet({ project });
    expect(document.querySelector(".react-flow__minimap")).toBeNull();
    await runCommand({ id: "sheet.minimapToggle" }, "palette");
    expect(settings.get().minimap).toBe(true);
    await expect.poll(() => document.querySelectorAll(".react-flow__minimap-node").length).toBe(12);
    await expect.element(page.getByRole("img", { name: "Minimap" })).toBeInTheDocument();

    const names = Object.keys(project.layout);
    const index = names.length - 1;
    const target = document.querySelectorAll<SVGRectElement>(".react-flow__minimap-node")[index];
    const svg = document.querySelector<SVGSVGElement>(".react-flow__minimap svg");
    if (!target || !svg) throw new Error("no minimap");
    const box = target.getBoundingClientRect();
    svg.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 }));
    const name = names[index] ?? "";
    await expect.poll(() => {
      const r = cardScreenRect(name);
      return Math.abs(r.x + r.width / 2 - SHEET_WIDTH / 2) < 12 && Math.abs(r.y + r.height / 2 - SHEET_HEIGHT / 2) < 12;
    }).toBe(true);

    await runCommand({ id: "sheet.minimapToggle" }, "palette");
    await expect.poll(() => document.querySelector(".react-flow__minimap")).toBeNull();
  });

  test("a focused card is panned clear of what floats over the sheet (2.4.11)", async () => {
    const project = sheetProject(4);
    await renderSheet({ project });
    await runCommand({ id: "sheet.zoomTo", args: { zoom: 1 } }, "palette");
    const name = Object.keys(project.layout)[0] ?? "";
    // A title block in the bottom-right corner, and the card moved under it.
    const float = document.createElement("div");
    float.dataset.sheetFloat = "";
    Object.assign(float.style, { position: "absolute", right: "0", bottom: "0", width: "300px", height: "200px" });
    flowElement().append(float);
    onCleanup(() => float.remove());
    const entry = project.layout[name];
    if (!entry) throw new Error("no entry");
    session.set((s) => ({ viewports: { ...s.viewports, [project.id]: { x: SHEET_WIDTH - 250 - entry.x, y: SHEET_HEIGHT - 150 - entry.y, zoom: 1 } } }));
    await expect.poll(() => cardScreenRect(name).x).toBeCloseTo(SHEET_WIDTH - 250, 0);

    expect(ensureVisible(name)).toBe(true);
    await expect.poll(() => {
      const r = cardScreenRect(name);
      const f = { left: SHEET_WIDTH - 300, top: SHEET_HEIGHT - 200 };
      return r.right <= f.left - 15 || r.bottom <= f.top - 15;
    }).toBe(true);
    expect(ensureVisible(name)).toBe(false);
  });

  test("keyboard focus on an off-screen card pans to it first", async () => {
    const project = sheetProject(4);
    await renderSheet({ project });
    session.set((s) => ({ viewports: { ...s.viewports, [project.id]: { x: -5000, y: -5000, zoom: 1 } } }));
    await expect.poll(() => drawnViewport().x).toBe(-5000);
    const stop = [...document.querySelectorAll<HTMLElement>(".react-flow__node[data-id]")].find((n) => n.tabIndex === 0);
    if (!stop) throw new Error("no tab stop");
    const before = document.createElement("button");
    before.textContent = "Before";
    flowElement().closest("[data-region]")?.prepend(before);
    onCleanup(() => before.remove());
    before.focus();
    await userEvent.tab();
    expect(document.activeElement).toBe(stop);
    await expect.poll(() => {
      const r = cardScreenRect(stop.dataset.id ?? "");
      return r.x >= 0 && r.right <= SHEET_WIDTH && r.y >= 0 && r.bottom <= SHEET_HEIGHT;
    }).toBe(true);
  });

  test("the card S9 focuses after undo or redo comes into view, even when the undo was clicked", async () => {
    const project = sheetProject(4);
    await renderSheet({ project });
    session.set((s) => ({ viewports: { ...s.viewports, [project.id]: { x: 6000, y: 6000, zoom: 1 } } }));
    await expect.poll(() => drawnViewport().x).toBe(6000);
    const name = Object.keys(project.layout)[2] ?? "";
    expect(await focusCard(name)).toBe(true);
    await expect.poll(() => {
      const r = cardScreenRect(name);
      return r.x >= 0 && r.right <= SHEET_WIDTH && r.y >= 0 && r.bottom <= SHEET_HEIGHT;
    }).toBe(true);
  });

  test("a pin row focused by keyboard in a card taller than the sheet comes into view without jumping to the header", async () => {
    const project = cardProject(fixtureCatalog(), ["Governor"], { expanded: ["Governor"] });
    await renderSheet({ project });
    session.set((s) => ({ viewports: { ...s.viewports, [project.id]: { x: 100, y: 40, zoom: 1 } } }));
    await expect.poll(() => drawnViewport().y).toBe(40);
    expect(cardScreenRect("Governor").height).toBeGreaterThan(SHEET_HEIGHT);
    const last = [...cardNode("Governor").querySelectorAll<HTMLElement>("[data-selector]")].at(-1);
    if (!last) throw new Error("Governor draws no rows.");
    await userEvent.keyboard("{ArrowDown}");
    last.focus();
    await expect.poll(() => {
      const box = flowElement().getBoundingClientRect();
      return last.getBoundingClientRect().bottom - box.top;
    }).toBeLessThanOrEqual(SHEET_HEIGHT - 15);
    // Only as far as the row needed: the card's header scrolled off the top rather than the view snapping to it.
    expect(cardScreenRect("Governor").y).toBeLessThan(0);
  });

  test("sheet.locate with a selector centers that pin's row", async () => {
    const project = sheetProject(8, { columns: 4 });
    await renderSheet({ project });
    const name = Object.keys(project.layout).at(-1) ?? "";
    const pins = [...cardNode(name).querySelectorAll<HTMLElement>("[data-selector]")];
    const pin = pins.at(-1);
    const selector = pin?.dataset.selector;
    if (!pin || !selector) throw new Error(`${name} draws no pin rows.`);
    await runCommand({ id: "sheet.locate", args: { facet: name, selector } }, "api");
    await drawn();
    const sheet = flowElement().getBoundingClientRect();
    const row = pin.getBoundingClientRect();
    expect(Math.abs(row.top + row.height / 2 - sheet.top - SHEET_HEIGHT / 2)).toBeLessThan(4);
  });
});
