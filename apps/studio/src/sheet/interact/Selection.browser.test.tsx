/**
 * Selecting (IR L42, L49-L50, IR L15, L17): click, Shift or ⌘ toggles, the marquee with a live highlight and
 * Shift adding, ⌘A, a click on empty sheet and Esc clearing; each change announced (spec L745).
 */
import { describe, expect, test } from "vitest";
import { commandState, onCommandRun, session } from "@/contracts";
import { onCleanup } from "../../../test/harness";
import {
  announced, cardNode, clickCard, marquee, position, press, releaseMarquee, renderInteractSheet, selection, sheetProject,
} from "./testing/interact-harness";

const ID = "selection";
const AT_ORIGIN = { session: { viewports: { [ID]: { x: 0, y: 0, zoom: 1 } } } };

async function sheet(count = 4) {
  const project = sheetProject(count, { id: ID });
  await renderInteractSheet({ project, ...AT_ORIGIN });
  return project;
}

describe("clicking cards", () => {
  test("a click selects one card; Shift or ⌘ adds and removes", async () => {
    const project = await sheet();
    const [a, b, c] = project.recipe.facets as [string, string, string];
    clickCard(a);
    expect(selection()).toEqual([a]);
    expect(announced().at(-1)).toBe(`Selected ${a}.`);
    clickCard(b, { shiftKey: true });
    expect(selection()).toEqual([a, b]);
    clickCard(c, { metaKey: true });
    expect(selection()).toEqual([a, b, c]);
    expect(announced().at(-1)).toBe("Selected 3 cards.");
    clickCard(a, { shiftKey: true });
    expect(selection()).toEqual([b, c]);
    clickCard(c);
    expect(selection()).toEqual([c]);
  });

  test("the card grid is one Tab stop, and it follows the card last clicked", async () => {
    const project = await sheet();
    const [, b] = project.recipe.facets as [string, string];
    clickCard(b);
    await expect.poll(() => [...document.querySelectorAll<HTMLElement>(".react-flow__node")].filter((n) => n.tabIndex === 0).map((n) => n.dataset.id)).toEqual([b]);
  });

  test("a double-click opens the card in the inspector with its Selectors list", async () => {
    const project = await sheet();
    const [a] = project.recipe.facets as [string];
    const ran: string[] = [];
    onCleanup(onCommandRun((ref) => void ran.push(ref.id)));
    cardNode(a).dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, view: window, detail: 2 }));
    await expect.poll(() => ran).toContain("inspector.focusSelectors");
    expect(session.get().panes.inspector.view).toMatchObject({ kind: "facet", facet: a, focus: "selectors" });
  });

  test("the card's description states it, and its wrapper carries the selection", async () => {
    const project = await sheet();
    const [a] = project.recipe.facets as [string];
    clickCard(a);
    await expect.poll(() => document.querySelector(`[data-facet="${a}"]`)?.hasAttribute("data-selected")).toBe(true);
  });

  test("a click on empty sheet clears; Shift-click there keeps the selection", async () => {
    const project = await sheet();
    const [a] = project.recipe.facets as [string];
    clickCard(a);
    await marquee({ x: 900, y: 650 }, { x: 900, y: 650 }, { shiftKey: true });
    expect(selection()).toEqual([a]);
    await marquee({ x: 900, y: 650 }, { x: 900, y: 650 });
    expect(selection()).toEqual([]);
    expect(announced().at(-1)).toBe("Selection cleared.");
  });
});

describe("the marquee", () => {
  test("cards it touches highlight live and stay selected on release", async () => {
    const project = await sheet(4);
    const [a, b] = project.recipe.facets as [string, string];
    // From empty sheet below the first row, up across the first two cards' bottoms.
    const bottom = position(a).y + 40;
    await marquee({ x: 10, y: 600 }, { x: position(b).x + 10, y: bottom }, { release: false });
    expect(selection()).toEqual([a, b]);
    expect(document.querySelector("[data-marquee]")).not.toBeNull();
    await releaseMarquee({ x: position(b).x + 10, y: bottom });
    expect(selection()).toEqual([a, b]);
    expect(document.querySelector("[data-marquee]")).toBeNull();
  });

  test("Shift adds to the selection there was", async () => {
    const project = await sheet(4);
    const [a, , , d] = project.recipe.facets as [string, string, string, string];
    clickCard(d);
    await marquee({ x: 10, y: 600 }, { x: position(a).x + 10, y: position(a).y + 40 }, { shiftKey: true });
    expect(selection()).toEqual([d, a]);
  });

  test("Esc during the drag puts the selection back", async () => {
    const project = await sheet(4);
    const [a, b] = project.recipe.facets as [string, string];
    clickCard(b);
    await marquee({ x: 10, y: 600 }, { x: position(a).x + 10, y: position(a).y + 40 }, { release: false });
    expect(selection()).toEqual([a]);
    press("Escape", {}, window);
    expect(selection()).toEqual([b]);
  });

  test("the Hand tool pans instead: no marquee", async () => {
    const project = await sheet(4);
    session.set({ tool: "hand" });
    const [a] = project.recipe.facets as [string];
    await marquee({ x: 10, y: 600 }, { x: position(a).x + 10, y: position(a).y + 40 });
    expect(selection()).toEqual([]);
  });
});

describe("keys", () => {
  test("⌘A selects every card on the sheet; Esc clears", async () => {
    const project = await sheet(4);
    press("a", { metaKey: true, code: "KeyA" }, document.querySelector('[data-region="sheet"]'));
    expect(selection()).toEqual(project.recipe.facets);
    expect(announced().at(-1)).toBe("Selected 4 cards.");
    press("Escape", {}, document.querySelector('[data-region="sheet"]'));
    expect(selection()).toEqual([]);
  });

  test("Clear the selection says why it can't with nothing selected", async () => {
    await sheet(2);
    expect(commandState({ id: "sheet.clearSelection" })).toMatchObject({ ok: false, reason: "Nothing is selected" });
    expect(commandState({ id: "sheet.selectAll" }).ok).toBe(true);
  });
});
