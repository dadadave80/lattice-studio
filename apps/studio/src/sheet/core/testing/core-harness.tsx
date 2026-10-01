/**
 * Helpers for the core's browser tests (never imported by the app): projects that carry the core's two facets in
 * the recipe and never on the sheet (the model's invariant), the sheet with the core's chunk landed, and the
 * cell, traces, glyphs and stamps by their data attributes.
 */
import { CORE_FACETS, type Project } from "@lattice-studio/core";
import { expect } from "vitest";
import { userEvent } from "vitest/browser";
import { fixtureCatalog, type StudioOptions } from "../../../../test/harness";
import { cardProject, type CardProjectOptions } from "../../card/testing/projects";
import { cardNode, flowElement, paneElement, renderInteractSheet } from "../../interact/testing/interact-harness";

export type CoreProjectOptions = CardProjectOptions & { id?: string; immutable?: boolean };

/** `facets` placed in a grid; the loupe and ERC-165 facets in the recipe, with no card. */
export function coreProject(facets: string[], options: CoreProjectOptions = {}): Project {
  const { id, immutable, ...rest } = options;
  const project = cardProject(fixtureCatalog(), facets, rest);
  const recipe = { ...project.recipe, facets: [...CORE_FACETS, ...facets], ...(immutable ? { immutable: true as const } : {}) };
  return { ...project, recipe, ...(id ? { id } : {}) };
}

/**
 * The sheet in its region with shortcuts on, the interactions loaded and the core cell drawn. The real pointer is
 * parked on empty sheet first: where the last test left it, a cell row or a card drawn under it would count as
 * hovered.
 */
export async function renderCoreSheet(options: StudioOptions = {}) {
  const screen = await renderInteractSheet(options);
  await expect.poll(() => document.querySelector("[data-core-cell]"), { timeout: 10_000 }).not.toBeNull();
  // Bottom left, under the zoom readout's row and left of the cell: empty sheet on every project these tests use.
  await userEvent.hover(paneElement(), { position: { x: 300, y: 690 } });
  return screen;
}

export function cell(): HTMLElement {
  const el = document.querySelector<HTMLElement>("[data-core-cell]");
  if (!el) throw new Error("The core cell isn't drawn.");
  return el;
}

/** A row of the cell by its accessible name. */
export function cellRow(name: string | RegExp): HTMLButtonElement {
  const rows = [...cell().querySelectorAll<HTMLButtonElement>("button")];
  const found = rows.find((row) => {
    const label = row.getAttribute("aria-label") ?? row.textContent ?? "";
    return typeof name === "string" ? label === name : name.test(label);
  });
  if (!found) throw new Error(`The cell has no row named ${String(name)}: ${rows.map((r) => r.getAttribute("aria-label")).join(", ")}.`);
  return found;
}

export function pad(which: "fallback" | "cut"): HTMLElement {
  const el = cell().querySelector<HTMLElement>(`[data-pad="${which}"]`);
  if (!el) throw new Error(`The cell has no ${which} pad.`);
  return el;
}

/** How a pad shows the trace ending on it ("soft", "live"), as the cell says it; null when none does. */
export function padTone(which: "fallback" | "cut"): string | null {
  return cell().getAttribute(`data-${which}-tone`);
}

export function traceOf(facet: string): SVGGElement | null {
  return document.querySelector<SVGGElement>(`[data-trace="${CSS.escape(facet)}"]`);
}

export function traces(): SVGGElement[] {
  return [...document.querySelectorAll<SVGGElement>("[data-trace]")];
}

export function glyphOf(facet: string): HTMLElement {
  const el = cardNode(facet).querySelector<HTMLElement>("[data-ground]");
  if (!el) throw new Error(`${facet} has no ground glyph.`);
  return el;
}

export function stampOf(facet: string): HTMLElement | null {
  return cardNode(facet).querySelector<HTMLElement>("[data-stamp]");
}

/** The wire's `d`, parsed: the glyph's lead, the gutter, the rail and the pad, in screen px relative to the sheet. */
export function wireOf(trace: SVGGElement): { start: { x: number; y: number }; gutter: number; rail: number; pad: { x: number; y: number } } {
  const d = trace.querySelector("path")?.getAttribute("d") ?? "";
  const match = /^M(-?[\d.]+) (-?[\d.]+)H(-?[\d.]+)V(-?[\d.]+)H(-?[\d.]+)V(-?[\d.]+)$/.exec(d);
  if (!match) throw new Error(`Not a wire: "${d}".`);
  const [, x, y, gutter, rail, padX, padY] = match.map(Number) as [number, number, number, number, number, number, number];
  return { start: { x, y }, gutter, rail, pad: { x: padX, y: padY } };
}

/** An element's rect relative to the sheet's top-left corner. */
export function rectIn(el: Element): DOMRect {
  const box = flowElement().getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return new DOMRect(r.left - box.left, r.top - box.top, r.width, r.height);
}

/** A plain click on empty sheet at `at` (relative to the sheet): pointer down and up without a move. */
export function clickPane(at: { x: number; y: number }): void {
  const box = flowElement().getBoundingClientRect();
  const pane = paneElement();
  const base = {
    bubbles: true, cancelable: true, view: window, button: 0, pointerId: 9, pointerType: "mouse", isPrimary: true,
    clientX: box.left + at.x, clientY: box.top + at.y,
  };
  pane.dispatchEvent(new PointerEvent("pointerdown", { ...base, buttons: 1 }));
  pane.dispatchEvent(new PointerEvent("pointerup", { ...base, buttons: 0 }));
}
