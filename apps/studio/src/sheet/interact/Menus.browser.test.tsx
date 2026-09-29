/**
 * The sheet's context menus (IR L190-L197): the card's, a pin's and the sheet's, by right click, long press or
 * Shift+F10, with the palette's commands; Esc closes and focus goes back.
 */
import { describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { doc, session } from "@/contracts";
import { paletteState, closePalette } from "@/palette/palette-state";
import { bufferedServices, onCleanup } from "../../../test/harness";
import { cardProject } from "../card/testing/projects";
import { fixtureCatalog } from "../../../test/harness";
import { cardNode, client, focusedCard, paneElement, press, renderInteractSheet, sheetProject } from "./testing/interact-harness";

const ID = "menus";
const VIEW = { session: { viewports: { [ID]: { x: 60, y: 80, zoom: 1 } } } };

async function sheet(count = 4) {
  const project = sheetProject(count, { id: ID });
  await renderInteractSheet({ project, ...VIEW });
  return project.recipe.facets as [string, string, string, string];
}

function menu(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="menu"]');
}

async function items(): Promise<string[]> {
  await expect.poll(() => menu()).not.toBeNull();
  return [...(menu()?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])].map((el) => {
    const id = el.getAttribute("aria-labelledby");
    return (id ? document.getElementById(id)?.textContent : el.textContent) ?? "";
  });
}

async function choose(label: string): Promise<void> {
  await expect.poll(() => menu()).not.toBeNull();
  await userEvent.click(page.getByRole("menuitem", { name: label }));
}

/** A pin row of `facet` that isn't a seam. */
function pinRow(facet: string): HTMLElement {
  const row = [...cardNode(facet).querySelectorAll<HTMLElement>("[data-card-row][data-selector]")].find((r) => r.dataset.state !== "seam");
  if (!row) throw new Error(`${facet} has no pin row.`);
  return row;
}

describe("the card menu", () => {
  test("a right click selects the card and opens its menu at the pointer", async () => {
    const [a] = await sheet();
    await userEvent.click(cardNode(a), { button: "right", position: { x: 60, y: 20 } });
    expect(await items()).toEqual([
      "Open in inspector", "Locate", "Move to…", "Flip pins", "Expand", "Route contested selectors here", "Remove",
    ]);
    expect(session.get().selection).toEqual([a]);
    expect(menu()?.getAttribute("aria-label")).toBe(`${a} actions`);
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => menu()).toBeNull();
  });

  test("with several selected: Tidy selection and Remove {n}", async () => {
    const [a, b] = await sheet();
    session.set({ selection: [a, b] });
    await userEvent.click(cardNode(b), { button: "right", position: { x: 60, y: 20 } });
    const labels = await items();
    expect(labels.slice(-2)).toEqual(["Tidy selection", "Remove 2"]);
    expect(session.get().selection).toEqual([a, b]);
    await choose("Remove 2");
    await expect.poll(() => Object.keys(doc.get().layout)).not.toContain(a);
    expect(Object.keys(doc.get().layout)).not.toContain(b);
  });

  test("Move to… from the card menu starts Move to…", async () => {
    const [a] = await sheet();
    await userEvent.click(cardNode(a), { button: "right", position: { x: 60, y: 20 } });
    await choose("Move to…");
    expect(session.get().modes.moveTo).toBe(true);
  });

  test("Shift+F10 on a focused card opens its menu below it on the first item; Esc returns focus to the card", async () => {
    const [a] = await sheet();
    cardNode(a).focus();
    press("F10", { shiftKey: true });
    await expect.poll(() => document.activeElement?.getAttribute("role")).toBe("menuitem");
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => menu()).toBeNull();
    await expect.poll(() => focusedCard()).toBe(a);
  });

  test("a long press opens it too (the browser's contextmenu for a touch)", async () => {
    const [a] = await sheet();
    cardNode(a).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 0, ...client({ x: 120, y: 120 }) }));
    expect((await items())[0]).toBe("Open in inspector");
  });

  test("read-only: the items stay, disabled with the reason", async () => {
    const [a] = await sheet();
    session.set({ readOnly: "Read-only: this is a shared link" });
    await userEvent.click(cardNode(a), { button: "right", position: { x: 60, y: 20 } });
    await items();
    const remove = page.getByRole("menuitem", { name: "Remove" });
    expect(remove.element().getAttribute("aria-disabled")).toBe("true");
    await expect.element(remove).toHaveAccessibleDescription("Read-only: this is a shared link");
  });
});

describe("the pin menu", () => {
  test("a pin that routes here: Leave out of the diamond, no Route here; then Bring back", async () => {
    const [a] = await sheet();
    const row = pinRow(a);
    expect(row.dataset.state).toBe("routed");
    await userEvent.click(row, { button: "right" });
    expect(await items()).toEqual(["Leave out of the diamond", "Copy selector", "Copy signature", "Show owner"]);
    expect(menu()?.getAttribute("aria-label")).toMatch(new RegExp(`^\\w+ · ${row.dataset.selector ?? ""} actions$`));
    await choose("Leave out of the diamond");
    await expect.poll(() => doc.get().recipe.exclude).toContain(row.dataset.selector);
    await userEvent.click(pinRow(a), { button: "right" });
    expect(await items()).toEqual(["Bring back", "Copy selector", "Copy signature", "Show owner"]);
  });

  test("a seam offers no route (spec L441); a pin served elsewhere offers Route here", async () => {
    await renderInteractSheet({ project: { ...cardProject(fixtureCatalog(), ["ERC20", "GovernedVault", "ERC20Pausable"]), id: ID }, ...VIEW });
    const seam = document.querySelector<HTMLElement>('[data-card-row][data-state="seam"]');
    if (!seam) throw new Error("No seam pin on the sheet.");
    // A seam row is disabled for clicks (it offers no route), so its menu comes from the contextmenu itself.
    const menuOn = (el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: r.left + 10, clientY: r.top + 5 }));
    };
    menuOn(seam);
    expect(await items()).toEqual(["Copy selector", "Copy signature", "Show owner"]);
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => menu()).toBeNull();
    const elsewhere = document.querySelector<HTMLElement>('[data-card-row][data-state="elsewhere"]');
    if (!elsewhere) throw new Error("No pin served by another facet on the sheet.");
    menuOn(elsewhere);
    expect(await items()).toEqual(["Route here", "Copy selector", "Copy signature", "Show owner"]);
  });

  test("Copy selector copies the hex and says so", async () => {
    const [a] = await sheet();
    const row = pinRow(a);
    const hex = row.dataset.selector ?? "";
    const written: string[] = [];
    const original = Object.getOwnPropertyDescriptor(Navigator.prototype, "clipboard");
    Object.defineProperty(navigator, "clipboard", {
      configurable: true, value: { writeText: async (text: string) => void written.push(text) },
    });
    onCleanup(() => {
      delete (navigator as unknown as Record<string, unknown>).clipboard;
      if (original) Object.defineProperty(Navigator.prototype, "clipboard", original);
    });
    await userEvent.click(row, { button: "right" });
    await choose("Copy selector");
    await expect.poll(() => written).toEqual([hex]);
    await expect.poll(() => bufferedServices().toast.at(-1)?.text).toMatch(new RegExp(`^Copied \`\\w+ · ${hex}\`$`));
    await userEvent.click(pinRow(a), { button: "right" });
    await choose("Copy signature");
    await expect.poll(() => written.length).toBe(2);
    expect(written[1]).toMatch(/^\w+\(.*\)$/);
  });

  test("Show owner selects and locates the facet that serves it", async () => {
    const [a] = await sheet();
    const row = pinRow(a);
    await userEvent.click(row, { button: "right" });
    await choose("Show owner");
    await expect.poll(() => session.get().selection.length).toBe(1);
    expect(bufferedServices().announce.map(([text]) => text).at(-1)).toMatch(/ serves `/);
  });
});

describe("the sheet menu", () => {
  test("Shift+F10 on the sheet itself opens it in the middle of the view; the key's own contextmenu doesn't reopen another", async () => {
    const [a] = await sheet();
    const region = document.querySelector<HTMLElement>('[data-region="sheet"]');
    if (!region) throw new Error("No sheet region.");
    region.focus();
    press("F10", { shiftKey: true }, region);
    expect(await items()).toContain("Add facet here…");
    // Windows follows the key with a contextmenu on whatever it targets.
    cardNode(a).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 0 }));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(menu()?.getAttribute("aria-label")).toBe("Sheet actions");
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => menu()).toBeNull();
    await expect.poll(() => document.activeElement).toBe(region);
  });

  test("with focus on nothing, a right click's menu gives focus back to the card grid", async () => {
    const [a] = await sheet();
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);
    // The menu key with nothing focused reaches the pane as a bare contextmenu (S4b forwards it).
    paneElement().dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 0, ...client({ x: 500, y: 450 }) }));
    await items();
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => focusedCard()).toBe(a);
  });


  test("a right click on empty sheet: Add facet here…, Tidy, Fit, Select all", async () => {
    await sheet();
    await userEvent.click(paneElement(), { button: "right", position: { x: 500, y: 450 } });
    expect(await items()).toEqual(["Add facet here…", "Tidy", "Fit", "Select all", "Paste"]);
    expect(menu()?.getAttribute("aria-label")).toBe("Sheet actions");
    const paste = page.getByRole("menuitem", { name: "Paste" });
    expect(paste.element().getAttribute("aria-disabled")).toBe("true");
    await expect.element(paste).toHaveAccessibleDescription("Arrives in v1.1");
  });

  test("Add facet here… opens the palette for facets, placing at the pointer", async () => {
    await sheet();
    onCleanup(closePalette);
    await userEvent.click(paneElement(), { button: "right", position: { x: 500, y: 450 } });
    await choose("Add facet here…");
    await expect.poll(() => paletteState().open).toBe(true);
    expect(paletteState().mode).toBe("facets");
    // (500, 450) on screen is (440, 370) on the sheet at this view.
    expect(paletteState().at).toEqual({ x: 440, y: 370 });
  });

  test("Select all selects every card", async () => {
    const facets = await sheet();
    await userEvent.click(paneElement(), { button: "right", position: { x: 500, y: 450 } });
    await choose("Select all");
    expect(session.get().selection).toEqual(facets);
  });
});
