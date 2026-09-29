/**
 * Which dialogs close on a scrim click (IR L188: "Clicking the scrim closes only dialogs that lose nothing by
 * closing"). Share, Settings, Projects and Keyboard shortcuts lose nothing and close; Choose per selector, Delete for
 * good and Clear data hold a choice or a destructive confirm and stay open, and so does the dialog under a stacked
 * one. The Deploy review needs Anvil and is checked in `deploy.spec.ts`.
 */
import type { Locator, Page } from "@playwright/test";
import { blankDiamond, type Recipe } from "@lattice-studio/core";
import { catalog } from "../_support/catalog.ts";
import { expect, test } from "../_support/fixtures.ts";
import { focusRegion, region } from "../_support/keys.ts";
import { collisionsProject, projectFor, recipeProject } from "../_support/projects.ts";
import { seedProject, storeProject } from "../_support/seed.ts";
import { clickScrim } from "./support/dialogs.ts";
import { runInPalette, tabTo, waitForSheet } from "./support/keyboard.ts";
import { focusFirstCard } from "./support/states.ts";

/** A recipe whose share link is over 2,000 characters: every facet, every selector owned. */
function everythingRecipe(): Recipe {
  const from = catalog();
  const base = blankDiamond(from);
  const facets = [...new Set([...base.facets, ...from.facets.map((f) => f.name)])];
  const owners: Record<string, string> = {};
  for (const facet of from.facets) for (const selector of facet.selectors) owners[selector.hex] = facet.name;
  return { ...base, facets, owners };
}

async function erc20(page: Page): Promise<void> {
  await seedProject(page, { project: recipeProject("ERC20", { filled: true }) });
  await waitForSheet(page);
}

type ScrimCase = {
  name: string;
  /** Seeds and opens the dialog; returns it. */
  open(page: Page): Promise<Locator>;
  /** Dialogs under it, which a scrim click must leave open too. */
  under?(page: Page): Locator[];
};

const dialog = (page: Page, name: string | RegExp) => page.getByRole("dialog", { name });

const CLOSES: readonly ScrimCase[] = [
  {
    name: "Share (over 2,000 characters)",
    async open(page) {
      await seedProject(page, { project: projectFor(everythingRecipe(), "Everything", {}, catalog()) });
      await waitForSheet(page);
      await focusRegion(page, "Title bar");
      await tabTo(page, region(page, "Title bar").getByRole("button", { name: "Share", exact: true }));
      await page.keyboard.press("Enter");
      return dialog(page, "Share");
    },
  },
  {
    name: "Settings",
    async open(page) {
      await erc20(page);
      await runInPalette(page, "Open Settings");
      return dialog(page, "Settings");
    },
  },
  {
    name: "Projects",
    async open(page) {
      await erc20(page);
      await runInPalette(page, "Projects");
      return dialog(page, "Projects");
    },
  },
  {
    name: "Keyboard shortcuts",
    async open(page) {
      await erc20(page);
      await focusFirstCard(page);
      await page.keyboard.press("?");
      return dialog(page, "Keyboard shortcuts");
    },
  },
];

const STAYS: readonly ScrimCase[] = [
  {
    name: "Choose per selector",
    async open(page) {
      await seedProject(page, { project: collisionsProject() });
      await waitForSheet(page);
      await focusRegion(page, "Sheet");
      await tabTo(page, region(page, "Sheet").getByRole("button", { name: "Choose per selector…" }).first());
      await page.keyboard.press("Enter");
      return dialog(page, /per selector/i);
    },
  },
  {
    name: "Delete for good, over Projects",
    async open(page) {
      await storeProject(page, { project: recipeProject("ERC20", { name: "Scrim trash" }) });
      await seedProject(page, { project: recipeProject("ERC20", { name: "Scrim open", filled: true }) });
      await waitForSheet(page);
      await runInPalette(page, "Projects");
      const projects = dialog(page, "Projects");
      await projects.getByRole("button", { name: "Delete Scrim trash", exact: true }).click();
      await projects.getByRole("tab", { name: /^Recently deleted/ }).click();
      await projects.getByRole("button", { name: "Delete Scrim trash for good" }).click();
      return page.getByRole("dialog").filter({ has: page.getByRole("button", { name: "Delete for good", exact: true }) });
    },
    under: (page) => [dialog(page, "Projects")],
  },
  {
    name: "Clear data, over Settings",
    async open(page) {
      await erc20(page);
      await runInPalette(page, "Open Settings");
      const settings = dialog(page, "Settings");
      await settings.getByRole("tab", { name: "Data" }).click();
      await settings.getByRole("button", { name: "Clear data" }).click();
      return dialog(page, "Clear data");
    },
    under: (page) => [dialog(page, "Settings")],
  },
];

test.describe("a scrim click closes a dialog that loses nothing (IR L188)", () => {
  for (const c of CLOSES) {
    test(c.name, async ({ page }) => {
      const popup = await c.open(page);
      await expect(popup).toBeVisible();
      await clickScrim(page, popup);
      await expect(popup).toHaveCount(0);
    });
  }
});

test.describe("a scrim click leaves a dialog that could lose something open (IR L188)", () => {
  for (const c of STAYS) {
    test(c.name, async ({ page }) => {
      const popup = await c.open(page);
      await expect(popup).toBeVisible();
      await clickScrim(page, popup);
      // Closing runs on the press itself; give it the time an exit animation would take before judging.
      await page.waitForTimeout(400);
      await expect(popup).toBeVisible();
      if (c.under) {
        // The dialog underneath is hidden from the accessibility tree while another is on top (`Dialog.tsx`), so
        // it shows it stayed by coming back once Esc closes the top one.
        await page.keyboard.press("Escape");
        await expect(popup).toHaveCount(0);
        for (const under of c.under(page)) await expect(under).toBeVisible();
      }
    });
  }
});
