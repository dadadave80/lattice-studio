/**
 * Helpers for the canvas's browser tests (never imported by the app): the sheet in a fixed-size region, the
 * live transform as React Flow draws it, and synthetic wheel, mouse and key input.
 */
import { CORE_FACETS, type Project } from "@lattice-studio/core";
import { makeProject, makeRecipe } from "@lattice-studio/core/testing";
import { expect } from "vitest";
import { doc, session, type Viewport } from "@/contracts";
import { fixtureCatalog, renderWithStudio, type StudioOptions } from "../../../../test/harness";
import { cardProject } from "../../card/testing/projects";
import { Sheet } from "../Sheet";
import { sheetViewport } from "../sheet-view";

export const SHEET_WIDTH = 1000;
export const SHEET_HEIGHT = 700;

/** `count` placed facets from the fixture catalog, in a grid. */
export function sheetProject(count: number, options: { id?: string; columns?: number } = {}): Project {
  const catalog = fixtureCatalog();
  const facets = catalog.facets.slice(0, count).map((f) => f.name);
  const project = cardProject(catalog, facets, { columns: options.columns ?? 4, rowPitch: 256 });
  return options.id ? { ...project, id: options.id } : project;
}

/** A project with no cards: core only, as every new project starts. */
export function emptyProject(id: string): Project {
  return makeProject({ id, recipe: makeRecipe({ facets: [...CORE_FACETS] }, fixtureCatalog()) });
}

/**
 * Renders the sheet in a 1000 × 700 region and waits until the project's viewport is applied. Motion is
 * reduced unless the test says otherwise, so viewport moves land at once.
 */
export async function renderSheet(options: StudioOptions = {}) {
  const screen = await renderWithStudio(
    <div data-region="sheet" style={{ position: "relative", width: SHEET_WIDTH, height: SHEET_HEIGHT }}>
      <Sheet />
    </div>,
    { ...options, settings: { reduceMotion: "on", ...options.settings } },
  );
  await settled();
  return screen;
}

/** Waits until the open project has a stored viewport and React Flow shows it. */
export async function settled(): Promise<void> {
  // A project with no viewport yet opens once the chrome's lazy chunks have drawn the floats (`floatsDrawn`).
  await expect.poll(() => session.get().viewports[doc.get().id] !== undefined, { timeout: 10_000 }).toBe(true);
  await expect.poll(() => sameAsStored()).toBe(true);
}

function sameAsStored(): boolean {
  const stored = session.get().viewports[doc.get().id];
  if (!stored) return false;
  const drawn = drawnViewport();
  return Math.abs(drawn.x - stored.x) < 0.5 && Math.abs(drawn.y - stored.y) < 0.5 && Math.abs(drawn.zoom - stored.zoom) < 1e-3;
}

export function flowElement(): HTMLElement {
  const el = document.querySelector<HTMLElement>(".react-flow");
  if (!el) throw new Error("The sheet isn't mounted.");
  return el;
}

export function paneElement(): HTMLElement {
  const el = document.querySelector<HTMLElement>(".react-flow__pane");
  if (!el) throw new Error("The sheet has no pane.");
  return el;
}

/**
 * Expands the title block as a person would (its Expand button), for tests about what sits beside the full block:
 * the 700 px tall test sheet is short, so it starts collapsed (David's decision on SH-01/SH-02). Focus, which
 * follows the toggle, is let go again, so no focus ring shows in a screenshot.
 */
export async function expandTitleBlock(): Promise<void> {
  const form = () => document.querySelector('[data-chrome="title-block"]')?.getAttribute("data-form") ?? null;
  await expect.poll(form, { timeout: 10_000 }).not.toBeNull();
  if (form() === "collapsed") document.querySelector<HTMLButtonElement>('[data-chrome="title-block"] [data-title-toggle]')?.click();
  await expect.poll(form).toBe("full");
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  // The core cell follows the block's new width a frame or two later: wait until it sits beside it again.
  await expect
    .poll(() => {
      const cell = document.querySelector("[data-core-cell]");
      const title = document.querySelector('[data-chrome="title-block"]');
      return !cell || !title || Math.abs(cell.getBoundingClientRect().right + 8 - title.getBoundingClientRect().left) < 2;
    })
    .toBe(true);
}

/** The transform React Flow draws now, read from the DOM (mid-glide too). */
export function drawnViewport(): Viewport {
  const el = document.querySelector<HTMLElement>(".react-flow__viewport");
  if (!el) throw new Error("The sheet has no viewport.");
  const matrix = new DOMMatrixReadOnly(getComputedStyle(el).transform);
  return { x: matrix.e, y: matrix.f, zoom: matrix.a };
}

/** Waits until React Flow has drawn where the view is going (a move lands on the next render), and returns it. */
export async function drawn(): Promise<Viewport> {
  await expect.poll(() => {
    const target = sheetViewport();
    const now = drawnViewport();
    return Math.abs(now.x - target.x) < 0.5 && Math.abs(now.y - target.y) < 0.5 && Math.abs(now.zoom - target.zoom) < 1e-3;
  }).toBe(true);
  return drawnViewport();
}

export function storedViewport(): Viewport | undefined {
  return session.get().viewports[doc.get().id];
}

export function cardNode(facet: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(facet)}"]`);
  if (!el) throw new Error(`${facet} has no card.`);
  return el;
}

/** A card's rect relative to the sheet's top-left corner. */
export function cardScreenRect(facet: string): DOMRect {
  const sheet = flowElement().getBoundingClientRect();
  const r = cardNode(facet).getBoundingClientRect();
  return new DOMRect(r.left - sheet.left, r.top - sheet.top, r.width, r.height);
}

/** A wheel event over the sheet's center (or `at`, relative to the sheet). */
export function wheel(init: WheelEventInit & { at?: { x: number; y: number } }): void {
  const box = flowElement().getBoundingClientRect();
  const at = init.at ?? { x: box.width / 2, y: box.height / 2 };
  paneElement().dispatchEvent(
    new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaMode: 0, clientX: box.left + at.x, clientY: box.top + at.y, ...init }),
  );
}

/** A mouse drag from `from` by `by`, both relative to the sheet, with `button` (0 left, 1 middle, 2 right). */
export async function drag(target: Element, from: { x: number; y: number }, by: { x: number; y: number }, button = 0): Promise<void> {
  const box = flowElement().getBoundingClientRect();
  const start = { clientX: box.left + from.x, clientY: box.top + from.y };
  const buttons = button === 0 ? 1 : button === 1 ? 4 : 2;
  const base = { bubbles: true, cancelable: true, view: window, button };
  target.dispatchEvent(new MouseEvent("mousedown", { ...base, ...start, buttons }));
  const steps = 5;
  for (let i = 1; i <= steps; i++) {
    window.dispatchEvent(new MouseEvent("mousemove", {
      ...base, buttons, clientX: start.clientX + (by.x * i) / steps, clientY: start.clientY + (by.y * i) / steps,
    }));
    await new Promise((resolve) => requestAnimationFrame(resolve));
  }
  window.dispatchEvent(new MouseEvent("mouseup", { ...base, buttons: 0, clientX: start.clientX + by.x, clientY: start.clientY + by.y }));
}

export function key(type: "keydown" | "keyup", keyValue: string, target: EventTarget = document.body): void {
  target.dispatchEvent(new KeyboardEvent(type, { key: keyValue, bubbles: true, cancelable: true }));
}
