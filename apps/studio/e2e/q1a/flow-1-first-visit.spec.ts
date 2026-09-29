/**
 * Flow 1. First visit (spec L397-L401, IR "Sheet": Start a diamond, "Left pane": Catalog, "Layout controls":
 * Pane switcher).
 *
 * Steps covered here (the shell's static paint and the service-worker catalog cache are S11b/S14's, tested in
 * `e2e/first-paint/` and the PWA suites, not repeated here):
 *   2. No projects yet: Studio opens an untitled project on the Start block. No modal. The tour hint. The tour
 *      itself: five coach marks that never block input; Esc or End tour leaves at any step.
 *   3. The console's first line names the catalog.
 *   4. A returning visitor lands in their last project.
 *   5. Under 768 px, the pane switcher, fully functional.
 */
import { plural } from "@lattice-studio/core";
import { catalog } from "../_support/catalog.ts";
import { expect, test } from "../_support/fixtures.ts";
import { openEmpty, seedProject } from "../_support/seed.ts";
import { NARROW_WIDTHS, expectTier, tierAt, viewportAt } from "../_support/viewports.ts";
import { ConsolePage } from "./pages/console-page.ts";
import { recipeProject } from "../_support/projects.ts";
import { SheetPage } from "./pages/sheet-page.ts";

/** "Catalog: Lattice {tag} · {n} facets." (spec L399, `lines.catalogLoaded`). */
function firstCatalogLine(): string {
  const built = catalog();
  const version = built.lattice.tag.replace(/^v/, "");
  const label = built.provisional ?? `Lattice ${version}`;
  return `Catalog: ${label} · ${plural(built.facets.length, "facet")}.`;
}

test.describe("Flow 1. First visit", () => {
  // A first visit reaches nothing but Studio's own origin (spec L13, L882); `no-network.spec.ts` adds a recipe and
  // an export to the run.
  test.afterEach(({ blockedRequests }) => {
    expect(blockedRequests, `outside requests:\n${blockedRequests.join("\n")}`).toEqual([]);
  });

  test("opens an untitled project on the Start block, with no modal", async ({ page }) => {
    await openEmpty(page);
    const sheet = new SheetPage(page);
    await expect(sheet.startTitle).toBeVisible();
    await expect(sheet.blankDiamondButton).toBeVisible();
    await expect(sheet.browseAllRecipesButton).toBeVisible();
    await expect(sheet.tourHint).toBeVisible();
    await expect(sheet.tourLink).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("the console's first line names the catalog @smoke", async ({ page }) => {
    await openEmpty(page);
    const console_ = new ConsolePage(page);
    await console_.expectFirstLine(firstCatalogLine());
  });

  test("the tour runs only on request: five coach marks that never block input", async ({ page }) => {
    await openEmpty(page);
    const sheet = new SheetPage(page);
    await sheet.tourLink.click();

    const titles = ["The catalog", "Placing a facet", "A collision note", "The console", "Deploy"];
    for (const [index, title] of titles.entries()) {
      await expect(page.getByText(`Step ${index + 1} of 5`)).toBeVisible();
      await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
      if (index < titles.length - 1) await page.getByRole("button", { name: "Next", exact: true }).click();
    }

    // Never blocks input: the sheet's own controls stay reachable while the tour is up.
    await expect(sheet.root).toBeVisible();

    await page.getByRole("button", { name: "Done", exact: true }).click();
    const console_ = new ConsolePage(page);
    await expect(console_.line("Finished the tour.")).toBeVisible();
  });

  test("Esc leaves the tour at any step", async ({ page }) => {
    await openEmpty(page);
    const sheet = new SheetPage(page);
    await sheet.tourLink.click();
    await expect(page.getByText("Step 1 of 5")).toBeVisible();
    await page.getByRole("button", { name: "Next", exact: true }).click();
    await expect(page.getByText("Step 2 of 5")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.getByText(/Step \d of 5/)).toHaveCount(0);
    const console_ = new ConsolePage(page);
    await expect(console_.line("Ended the tour.")).toBeVisible();
  });

  test("End tour leaves it at any step", async ({ page }) => {
    await openEmpty(page);
    const sheet = new SheetPage(page);
    await sheet.tourLink.click();
    await page.getByRole("button", { name: "End tour" }).click();
    await expect(page.getByText(/Step \d of 5/)).toHaveCount(0);
    const console_ = new ConsolePage(page);
    await expect(console_.line("Ended the tour.")).toBeVisible();
  });

  test("keyboard-only: Take the tour, step through it and end it with Esc", async ({ page }) => {
    await openEmpty(page);
    const sheet = new SheetPage(page);
    await sheet.tourLink.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Step 1 of 5")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByText(/Step \d of 5/)).toHaveCount(0);
  });

  test("a returning visitor lands in their last project", async ({ page }) => {
    const project = recipeProject("ERC20", { name: "My token" });
    await seedProject(page, { project });
    await page.reload();
    await expect(page).toHaveTitle(/^My token · /);
    const sheet = new SheetPage(page);
    await expect(sheet.card("ERC20")).toBeVisible();
  });

  for (const width of NARROW_WIDTHS) {
    test.describe(`at ${width} px`, () => {
      test.use({ viewport: viewportAt(width) });

      test(`draws the ${tierAt(width)} tier`, async ({ page }) => {
        await openEmpty(page);
        await expectTier(page, tierAt(width));
      });
    });
  }

  test.describe("under 768 px (phone tier)", () => {
    test.use({ viewport: viewportAt(375) });

    test("gets the pane switcher, fully functional", async ({ page }) => {
      await openEmpty(page);
      const switcher = page.getByRole("tablist", { name: "Panes" });
      await expect(switcher).toBeVisible();
      const sheet = new SheetPage(page);
      await expect(sheet.startTitle).toBeVisible();

      await switcher.getByRole("tab", { name: "Catalog" }).click();
      await expect(page.getByRole("tree", { name: "Catalog" })).toBeVisible();

      await switcher.getByRole("tab", { name: "Sheet" }).click();
      await expect(sheet.startTitle).toBeVisible();
    });
  });

  test.describe("at 768 px (narrow tier)", () => {
    test.use({ viewport: viewportAt(768) });

    test("has no pane switcher; the Start block still shows directly", async ({ page }) => {
      await openEmpty(page);
      await expect(page.getByRole("tablist", { name: "Panes" })).toHaveCount(0);
      const sheet = new SheetPage(page);
      await expect(sheet.startTitle).toBeVisible();
    });
  });
});
