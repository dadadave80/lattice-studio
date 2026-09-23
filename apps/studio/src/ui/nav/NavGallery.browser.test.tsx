import { describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { renderWithStudio } from "../../../test/harness";
import { axeViolations } from "../testing/axe";
import { NavGallery } from "./NavGallery";

describe("NavGallery", () => {
  for (const theme of ["shop", "draft"] as const) {
    test(`is axe-clean in ${theme}`, async () => {
      const screen = await renderWithStudio(<NavGallery />, { theme });
      await expect.element(page.getByRole("tree", { name: "Large tree" })).toBeVisible();
      expect(await axeViolations(screen.container)).toEqual([]);
    });
  }

  test("shows every specimen: tabs, toolbars, trees and splitters", async () => {
    await renderWithStudio(<NavGallery />);
    await expect.element(page.getByRole("tablist", { name: "Left pane" })).toBeVisible();
    await expect.element(page.getByRole("toolbar", { name: "Sheet tools" })).toBeVisible();
    await expect.element(page.getByRole("tree", { name: "Structure" })).toBeVisible();
    await expect.element(page.getByRole("separator", { name: "Resize left pane" })).toBeVisible();
    await expect.element(page.getByRole("separator", { name: "Resize inspector" })).toHaveAttribute("aria-valuetext", "Collapsed");
    expect(document.querySelectorAll('[aria-label="Large tree"] [role="treeitem"]').length).toBeLessThan(100);
  });
});
