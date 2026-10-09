/**
 * The sheet before its canvas chunk has loaded (Q19, Q28): the empty sheet's Start block is already there and
 * works, and a catalog row dropped on the sheet places nothing and says "The sheet is still loading." rather than
 * vanishing. Once the canvas mounts it takes the drop, and its own Start block takes over, with focus on the control
 * that had it in the loading sheet's block. The canvas's lazy import
 * is held back here until the test releases it.
 */
import { describe, expect, test, vi } from "vitest";
import { doc, startCatalogDrag } from "@/contracts";
import { bufferedServices, fixtureCatalog, renderWithStudio } from "../../../test/harness";
import { BLANK_DIAMOND_LABEL } from "@/sheet/chrome/copy";
import { SHEET_LOADING } from "./copy";
import { Sheet } from "./Sheet";
import { emptyProject } from "./testing/sheet-harness";

const gate = vi.hoisted(() => {
  let release: () => void = () => {};
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { opened, release: () => release() };
});

vi.mock("./SheetCanvas", async (importOriginal) => {
  await gate.opened;
  return importOriginal();
});

function pointer(type: "pointermove" | "pointerup", at: { clientX: number; clientY: number }): void {
  window.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 21, pointerType: "mouse", isPrimary: true, ...at }));
}

const loading = () => document.querySelector<HTMLElement>("[data-sheet-loading]");
const startBlock = () => document.querySelector("[data-chrome='start']");
const blankDiamond = () =>
  Array.from(document.querySelectorAll<HTMLElement>("[data-chrome='start'] button")).find((b) => b.textContent === BLANK_DIAMOND_LABEL);

describe("the sheet while its canvas loads", () => {
  test("shows the Start block, and a drop says the sheet is still loading", async () => {
    await renderWithStudio(
      <div data-region="sheet" style={{ position: "relative", width: 1000, height: 700 }}>
        <Sheet />
      </div>,
      { project: emptyProject("sheet-loading") },
    );
    await expect.poll(loading).not.toBeNull();
    expect(document.querySelector(".react-flow")).toBeNull();
    // The Start block is there before the canvas, outside React Flow.
    expect(loading()?.contains(startBlock())).toBe(true);

    const facet = fixtureCatalog().facets[0]?.name;
    if (!facet) throw new Error("The fixture catalog has no facets.");
    const box = loading()?.getBoundingClientRect();
    if (!box) throw new Error("The loading sheet isn't laid out.");
    // Over the sheet's ground, beside the Start block.
    const at = { clientX: box.left + 24, clientY: box.top + 24 };
    startCatalogDrag(facet, { pointerId: 21, clientX: box.left - 100, clientY: at.clientY });
    pointer("pointermove", at);
    pointer("pointerup", at);
    await expect.poll(() => bufferedServices().log.at(-1)?.text).toBe(SHEET_LOADING);
    expect(bufferedServices().announce.at(-1)?.[0]).toBe(SHEET_LOADING);
    expect(doc.get().recipe.facets).not.toContain(facet);

    // A keyboard user in the block while the canvas loads.
    const before = blankDiamond();
    before?.focus();
    expect(document.activeElement).toBe(before);

    gate.release();
    await expect.poll(() => document.querySelector(".react-flow"), { timeout: 10_000 }).not.toBeNull();
    expect(loading()).toBeNull();
    // The canvas's own Start block layer has taken over, and the same control has focus in it.
    await expect.poll(() => startBlock()?.closest(".react-flow")).not.toBeNull();
    expect(before?.isConnected).toBe(false);
    expect(document.activeElement).toBe(blankDiamond());
    expect(document.activeElement?.closest(".react-flow")).not.toBeNull();
  });
});
