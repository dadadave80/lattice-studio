/**
 * The sheet inside the real shell (PA L14, bug 6): collapsing or expanding the console, the inspector or the
 * left pane, and switching panes under 768 px, never resets pan and zoom or remounts the sheet.
 */
import { afterEach, expect, test } from "vitest";
import { page } from "vitest/browser";
import { runCommand, type CommandRef } from "@/contracts";
import { Shell } from "@/shell";
import { renderWithStudio } from "../../../test/harness";
import { drawn, drawnViewport, flowElement, settled, sheetProject, storedViewport, wheel } from "./testing/sheet-harness";

afterEach(async () => {
  await page.viewport(1440, 900);
});

async function unchangedAfter(ref: CommandRef): Promise<void> {
  const flow = flowElement();
  const view = drawnViewport();
  const stored = storedViewport();
  await runCommand(ref, "palette");
  await new Promise((resolve) => setTimeout(resolve, 120));
  expect(flowElement()).toBe(flow);
  expect(drawnViewport()).toEqual(view);
  expect(storedViewport()).toEqual(stored);
}

test("pane toggles and the pane switcher keep the sheet's viewport and never remount it", async () => {
  await page.viewport(1440, 900);
  await renderWithStudio(<Shell />, { project: sheetProject(8), settings: { reduceMotion: "on" } });
  await settled();
  await runCommand({ id: "sheet.zoomTo", args: { zoom: 0.5 } }, "palette");
  await drawn();
  const before = drawnViewport();
  wheel({ deltaY: 90, deltaX: -60 });
  await expect.poll(() => storedViewport()?.x).not.toBe(before.x);
  await drawn();

  for (const pane of ["console", "inspector", "left"] as const) {
    await unchangedAfter({ id: "pane.toggle", args: { pane } });
    await unchangedAfter({ id: "pane.toggle", args: { pane } });
  }

  await page.viewport(600, 900);
  await new Promise((resolve) => setTimeout(resolve, 120));
  const flow = flowElement();
  const stored = storedViewport();
  await runCommand({ id: "pane.show", args: { pane: "catalog" } }, "palette");
  await expect.poll(() => flow.checkVisibility()).toBe(false);
  await runCommand({ id: "pane.show", args: { pane: "sheet" } }, "palette");
  await expect.poll(() => flow.checkVisibility()).toBe(true);
  expect(flowElement()).toBe(flow);
  expect(storedViewport()).toEqual(stored);
  expect(drawnViewport()).toEqual({ x: stored?.x, y: stored?.y, zoom: stored?.zoom });
});
