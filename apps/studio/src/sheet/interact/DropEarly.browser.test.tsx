/**
 * A catalog row dropped on the sheet before the interactions layer's overlays have loaded (Flow 3) isn't lost:
 * the drop target lives in the layer's shell, so the facet is placed at the drop point; the overlays (the ghost
 * among them) arrive afterwards. The overlays' lazy import is held back here until the test releases it.
 */
import { describe, expect, test, vi } from "vitest";
import { doc, startCatalogDrag } from "@/contracts";
import { fixtureCatalog } from "../../../test/harness";
import { client, renderInteractSheet, selection, sheetProject } from "./testing/interact-harness";

const gate = vi.hoisted(() => {
  let release: () => void = () => {};
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { opened, release: () => release() };
});

vi.mock("./SheetOverlays", async (importOriginal) => {
  await gate.opened;
  return importOriginal();
});

const ID = "drop-early";

function pointer(type: "pointermove" | "pointerup", at: { clientX: number; clientY: number }): void {
  window.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 11, pointerType: "mouse", isPrimary: true, ...at }));
}

const overlays = () => document.querySelector('[data-tour="place-facet"]');

describe("dropping a catalog row before the overlays have loaded", () => {
  test("is placed at the drop point, and the overlays load after", async () => {
    const project = sheetProject(2, { id: ID });
    await renderInteractSheet({ project, session: { viewports: { [ID]: { x: 60, y: 80, zoom: 1 } } } }, { overlays: false });
    const facet = fixtureCatalog().facets.map((f) => f.name).find((name) => !project.recipe.facets.includes(name));
    if (!facet) throw new Error("Every fixture facet is placed.");
    // The drop target is up while the chunk is held back.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(overlays()).toBeNull();

    startCatalogDrag(facet, { pointerId: 11, ...client({ x: -100, y: 300 }) });
    pointer("pointermove", client({ x: 600, y: 500 }));
    pointer("pointerup", client({ x: 600, y: 500 }));
    // (600, 500) on screen is (540, 420) on the sheet; the pointer holds the card by its header's middle.
    await expect.poll(() => doc.get().layout[facet]).toMatchObject({ x: 424, y: 400 });
    expect(selection()).toEqual([facet]);
    expect(overlays()).toBeNull();

    gate.release();
    await expect.poll(overlays, { timeout: 10_000 }).not.toBeNull();
    expect(doc.get().layout[facet]).toMatchObject({ x: 424, y: 400 });
  });
});
