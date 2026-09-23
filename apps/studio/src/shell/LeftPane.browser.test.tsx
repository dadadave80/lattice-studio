import { describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { commandRef, initialSession, runCommand } from "@/contracts";
import { renderWithStudio } from "../../test/harness";
import { LeftPane } from "./LeftPane";

/** The dev server compiles the lazy Structure chunk on first request, which can take a few seconds. */
const LOAD_TIMEOUT = 10_000;

/** What the Structure tab's panel holds (the tab names its panel with `aria-controls`), or null while empty. */
function structurePanel(): Element | null {
  const tab = page.getByRole("tab", { name: "Structure" }).element();
  const panel = document.getElementById(tab.getAttribute("aria-controls") ?? "");
  if (!panel) throw new Error("The Structure tab names no panel.");
  return panel.firstElementChild;
}

describe("LeftPane", () => {
  test("Structure loads the first time its tab shows, then stays mounted behind Catalog", async () => {
    await renderWithStudio(<LeftPane tier="wide" />);
    await expect.element(page.getByRole("tab", { name: "Catalog" })).toHaveAttribute("aria-selected", "true");
    expect(structurePanel()).toBeNull();

    await runCommand(commandRef("pane.show", { pane: "structure" }), "button");
    await expect.element(page.getByRole("tab", { name: "Structure" })).toHaveAttribute("aria-selected", "true");
    await expect.poll(structurePanel, { timeout: LOAD_TIMEOUT }).not.toBeNull();
    const mounted = structurePanel();

    await runCommand(commandRef("pane.show", { pane: "catalog" }), "button");
    await expect.element(page.getByRole("tab", { name: "Catalog" })).toHaveAttribute("aria-selected", "true");
    expect(structurePanel()).toBe(mounted);
  });

  test("Structure loads at once when the session opens on its tab", async () => {
    const panes = initialSession().panes;
    await renderWithStudio(<LeftPane tier="wide" />, {
      session: { panes: { ...panes, left: { ...panes.left, tab: "structure" } } },
    });
    await expect.element(page.getByRole("tab", { name: "Structure" })).toHaveAttribute("aria-selected", "true");
    await expect.poll(structurePanel, { timeout: LOAD_TIMEOUT }).not.toBeNull();
  });
});
