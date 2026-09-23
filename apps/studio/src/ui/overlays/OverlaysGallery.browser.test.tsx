import axe from "axe-core";
import { describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { renderWithStudio } from "../../../test/harness";
import { OverlaysGallery } from "./OverlaysGallery";

/**
 * Axe violations on the page. `open` skips the best-practice `region` rule: a menu or popover portals to
 * `<body>`, outside every landmark, by design. Base UI's focus guards (aria-hidden spans that hand focus
 * straight on while a non-modal popup is open) are excluded: nothing can rest on them.
 */
async function violations(open = false): Promise<string[]> {
  const rules = open ? { region: { enabled: false } } : {};
  const context = { include: [document.body], exclude: [["[data-base-ui-focus-guard]"]] };
  const result = await axe.run(context, { resultTypes: ["violations"], rules });
  return result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

describe("OverlaysGallery", () => {
  for (const theme of ["shop", "draft"] as const) {
    test(`nothing is open by default and it's axe-clean (${theme})`, async () => {
      await renderWithStudio(<OverlaysGallery />, { theme });
      await expect.element(page.getByRole("heading", { name: "Overlays" })).toBeVisible();
      expect(document.querySelector('[role="menu"], [role="dialog"]')).toBeNull();
      expect(await violations()).toEqual([]);
    });

    test(`open overlays are axe-clean (${theme})`, async () => {
      await renderWithStudio(<OverlaysGallery />, { theme });
      // No fades: axe measures contrast on whatever is on screen.
      document.documentElement.dataset.motion = "reduce";
      const gone = (role: "menu" | "dialog") => expect.poll(() => document.querySelector(`[role="${role}"]`)).toBeNull();
      await page.getByRole("button", { name: "Export" }).click();
      await expect.element(page.getByRole("menu", { name: "Export" })).toBeVisible();
      expect(await violations(true)).toEqual([]);
      await userEvent.keyboard("{Escape}");
      await gone("menu");

      await page.getByRole("button", { name: "Deploy…" }).click();
      await expect.element(page.getByRole("dialog", { name: "Deploy review" })).toBeVisible();
      expect(await violations(true)).toEqual([]);
      await userEvent.keyboard("{Escape}");
      await gone("dialog");

      await page.getByRole("button", { name: "Salt" }).click();
      await expect.element(page.getByRole("dialog", { name: "Salt" })).toBeVisible();
      expect(await violations(true)).toEqual([]);
      await userEvent.keyboard("{Escape}");
      await gone("dialog");

      await page.getByRole("button", { name: "Show toast" }).click();
      await expect.element(page.getByText("Removed 2 facets")).toBeVisible();
      expect(await violations(true)).toEqual([]);

      await page.getByRole("button", { name: "Show error toast" }).click();
      await expect.element(page.getByRole("img", { name: "Error" })).toBeVisible();
      expect(await violations(true)).toEqual([]);
    });
  }
});
