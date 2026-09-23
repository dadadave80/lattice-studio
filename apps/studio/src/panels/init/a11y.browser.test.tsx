import { describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { openDialog } from "@/contracts";
import { DialogHost } from "@/ui";
import { axeViolations } from "@/ui/testing/axe";
import { renderWithStudio } from "../../../test/harness";
import { InitEditor } from "./InitEditor";
import { projectFor, templateRecipe } from "./test-support";

describe("accessibility in both themes (WCAG 2.2 AA)", () => {
  for (const theme of ["shop", "draft"] as const) {
    test(`the init plan has no axe violations in ${theme}`, async () => {
      const project = projectFor(templateRecipe("SafeDiamondCut"), { provenance: { "steps[0].admin": "link" } });
      const screen = await renderWithStudio(<InitEditor view={{ kind: "init" }} />, { project, theme });
      await expect.element(page.getByRole("heading", { name: "Init plan" })).toBeVisible();
      expect(await axeViolations(screen.container)).toEqual([]);
    });

    test(`the bundle form has no axe violations in ${theme}`, async () => {
      const screen = await renderWithStudio(<InitEditor view={{ kind: "init" }} />, { project: projectFor(templateRecipe("GovernedVault")), theme });
      await expect.element(page.getByRole("heading", { name: "GovernedVaultInit" })).toBeVisible();
      expect(await axeViolations(screen.container)).toEqual([]);
    });

    test(`Choose an upgrade mechanism has no axe violations in ${theme}`, async () => {
      await renderWithStudio(<DialogHost />, { project: projectFor(templateRecipe("ERC20")), theme });
      openDialog("choose-mechanism", { preset: "safe" });
      const dialog = page.getByRole("dialog", { name: "Choose an upgrade mechanism" });
      await expect.element(dialog).toBeVisible();
      expect(await axeViolations(dialog.element())).toEqual([]);
    });
  }
});
