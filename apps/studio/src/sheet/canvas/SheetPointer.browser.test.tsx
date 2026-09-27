/**
 * Right-click on empty sheet reaches S4e's `onPaneContextMenu` (IR L46) while right drag pans (IR L52), in both
 * platform orders; and a pointer press on a visible card never moves the view (spec L771 applies to keyboard
 * focus only).
 */
import { describe, expect, test } from "vitest";
import { userEvent } from "vitest/browser";
import { provideSheetInteractions, session } from "@/contracts";
import { onCleanup } from "../../../test/harness";
import {
  cardNode, cardScreenRect, drag, drawnViewport, flowElement, paneElement, renderSheet, SHEET_HEIGHT, SHEET_WIDTH,
  sheetProject,
} from "./testing/sheet-harness";

/** Collects the events the interactions seam receives for a right-click on empty sheet. */
function paneMenus(): MouseEvent[] {
  const calls: MouseEvent[] = [];
  onCleanup(provideSheetInteractions(() => ({ onPaneContextMenu: (event) => void calls.push(event as MouseEvent) })));
  return calls;
}

const AT = { x: 500, y: 660 }; // Empty sheet; the bottom-right corner belongs to S4d's title block.

function point(offset = { x: 0, y: 0 }) {
  const box = flowElement().getBoundingClientRect();
  return { clientX: box.left + AT.x + offset.x, clientY: box.top + AT.y + offset.y };
}

function pointer(type: string, offset?: { x: number; y: number }): void {
  paneElement().dispatchEvent(
    new PointerEvent(type, { bubbles: true, cancelable: true, button: 2, buttons: type === "pointerup" ? 0 : 2, pointerType: "mouse", ...point(offset) }),
  );
}

function contextMenu(offset?: { x: number; y: number }): MouseEvent {
  const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, ...point(offset) });
  paneElement().dispatchEvent(event);
  return event;
}

describe("right-click on empty sheet", () => {
  test("a real right click reaches onPaneContextMenu once, with no browser menu", async () => {
    const calls = paneMenus();
    await renderSheet({ project: sheetProject(4) });
    const before = drawnViewport();
    await userEvent.click(paneElement(), { button: "right", position: AT });
    await expect.poll(() => calls.length).toBe(1);
    expect(calls[0]?.target).toBe(paneElement());
    expect(calls[0]?.defaultPrevented).toBe(true);
    expect(drawnViewport()).toEqual(before);
  });

  test("macOS order (menu with the press): a click opens it on release, a drag pans and opens nothing", async () => {
    const calls = paneMenus();
    await renderSheet({ project: sheetProject(4) });
    pointer("pointerdown");
    const menu = contextMenu();
    expect(calls).toHaveLength(0);
    pointer("pointerup");
    expect(calls).toEqual([menu]);

    calls.length = 0;
    pointer("pointerdown");
    contextMenu();
    pointer("pointermove", { x: -30, y: 0 });
    pointer("pointerup", { x: -30, y: 0 });
    expect(calls).toHaveLength(0);
  });

  test("Windows and Linux order (menu after the release): a click opens it, a drag doesn't", async () => {
    const calls = paneMenus();
    await renderSheet({ project: sheetProject(4) });
    pointer("pointerdown");
    pointer("pointerup");
    const menu = contextMenu();
    expect(calls).toEqual([menu]);

    calls.length = 0;
    pointer("pointerdown");
    pointer("pointermove", { x: 0, y: 25 });
    pointer("pointerup", { x: 0, y: 25 });
    contextMenu({ x: 0, y: 25 });
    expect(calls).toHaveLength(0);
  });

  test("the menu key or a long press (no right press first) opens it at once; a right drag still pans", async () => {
    const calls = paneMenus();
    await renderSheet({ project: sheetProject(4) });
    const menu = contextMenu();
    expect(calls).toEqual([menu]);
    const before = drawnViewport();
    await drag(paneElement(), AT, { x: -60, y: 0 }, 2);
    await expect.poll(() => drawnViewport().x).toBeCloseTo(before.x - 60, 0);
  });

  test("a right click on a card isn't the sheet's menu", async () => {
    const calls = paneMenus();
    const project = sheetProject(2);
    await renderSheet({ project });
    const name = Object.keys(project.layout)[0] ?? "";
    await userEvent.click(cardNode(name), { button: "right", position: { x: 20, y: 12 } });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(calls).toHaveLength(0);
  });
});

describe("double-click on empty sheet (IR L52, spec L752)", () => {
  test("does nothing: the viewport, the zoom and the selection stay as they were", async () => {
    const project = sheetProject(4);
    await renderSheet({ project });
    const before = drawnViewport();
    const stored = session.get().viewports[project.id];
    const unchanged = async (selection: string[]) => {
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(drawnViewport()).toEqual(before);
      expect(session.get().viewports[project.id]).toEqual(stored);
      expect(session.get().selection).toEqual(selection);
    };
    // A real double-click over empty sheet: no zoom (React Flow's zoomOnDoubleClick is off).
    await userEvent.dblClick(paneElement(), { position: AT });
    await unchanged([]);
    // The dblclick event itself, with a card selected: the selection stays too. (A real double-click's two
    // clicks clear it, as any click on empty sheet does, IR L51.)
    const name = Object.keys(project.layout)[0] ?? "";
    session.set({ selection: [name] });
    const box = flowElement().getBoundingClientRect();
    paneElement().dispatchEvent(new MouseEvent("dblclick", {
      bubbles: true, cancelable: true, view: window, detail: 2, clientX: box.left + AT.x, clientY: box.top + AT.y,
    }));
    await unchanged([name]);
  });
});

describe("pointer focus never pans", () => {
  test("pressing a visible card whose corner is under a floating panel leaves the view where it is", async () => {
    const project = sheetProject(4);
    await renderSheet({ project });
    const name = Object.keys(project.layout)[0] ?? "";
    const entry = project.layout[name];
    if (!entry) throw new Error("no entry");
    const float = document.createElement("div");
    float.dataset.sheetFloat = "";
    Object.assign(float.style, { position: "absolute", right: "0", bottom: "0", width: "300px", height: "200px", zIndex: "10" });
    flowElement().append(float);
    onCleanup(() => float.remove());
    // The card's bottom-right corner sits under the float; its top-left is clear.
    session.set((s) => ({ viewports: { ...s.viewports, [project.id]: { x: SHEET_WIDTH - 360 - entry.x, y: SHEET_HEIGHT - 260 - entry.y, zoom: 1 } } }));
    await expect.poll(() => cardScreenRect(name).x).toBeCloseTo(SHEET_WIDTH - 360, 0);
    const before = drawnViewport();
    const card = cardNode(name);
    await userEvent.click(card, { position: { x: 16, y: 12 } });
    expect(document.activeElement?.closest(".react-flow__node")).toBe(card);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(drawnViewport()).toEqual(before);
  });
});
