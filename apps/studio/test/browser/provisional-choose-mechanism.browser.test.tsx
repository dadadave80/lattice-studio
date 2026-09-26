/**
 * PA L76: "The Choose an upgrade mechanism dialog and the Authority table (Flow 17)" has no board. Built from
 * the design system's dialog and table primitives and ChooseMechanismDialog.browser.test.tsx /
 * InitEditor.browser.test.tsx's real scenarios.
 */
import type { Project } from "@lattice-studio/core";
import { beforeAll, describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { openDialog } from "@/contracts";
import { InitEditor } from "@/panels/init/InitEditor";
import { projectFor, templateRecipe } from "@/panels/init/test-support";
import { DialogHost } from "@/ui/overlays/DialogHost";
import { renderWithStudio } from "../harness";

const TITLE = "Choose an upgrade mechanism";

beforeAll(async () => {
  await Promise.all(
    ['400 13px "JetBrains Mono"', '600 13px "JetBrains Mono"', '400 14px Inter', '600 14px Inter', '600 12px Inter'].map(
      (font) => document.fonts.load(font),
    ),
  );
});

async function openMechanismDialog(theme: "shop" | "draft", project: Project) {
  await renderWithStudio(<DialogHost />, { theme, project });
  openDialog("choose-mechanism", {});
  const dialog = page.getByRole("dialog", { name: TITLE });
  await expect.element(dialog).toBeVisible();
  return dialog;
}

describe.each(["shop", "draft"] as const)("provisional: Choose an upgrade mechanism, its options (%s)", (theme) => {
  test("five options, the current one focused, Governance disabled with its reason", async () => {
    const dialog = await openMechanismDialog(theme, projectFor(templateRecipe("SafeDiamondCut")));
    for (const label of ["Admin role", "Safe", "Safe with delay", "Governance", "Immutable"]) {
      await expect.element(dialog.getByRole("radio", { name: label, exact: true })).toBeVisible();
    }
    await expect.element(dialog.getByRole("radio", { name: "Governance" })).toHaveAttribute("aria-disabled", "true");
    await document.fonts.ready;
    await expect.element(page.elementLocator(dialog.element() as HTMLElement)).toMatchScreenshot(`provisional-choose-mechanism-options-${theme}`);
  });
});

describe.each(["shop", "draft"] as const)("provisional: the Authority table (%s)", (theme) => {
  test("every role, its holder in full, and how it got there", async () => {
    await renderWithStudio(<InitEditor view={{ kind: "init" }} />, { theme, project: projectFor(templateRecipe("GovernedVault")) });
    const table = page.getByRole("table", { name: "Authority" });
    await expect.element(table).toBeVisible();
    await expect.element(page.getByText("DEFAULT_ADMIN_ROLE")).toBeVisible();
    await document.fonts.ready;
    await expect.element(page.elementLocator(table.element() as HTMLElement)).toMatchScreenshot(`provisional-authority-table-${theme}`);
  });
});
