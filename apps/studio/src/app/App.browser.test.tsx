import { afterEach, describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { renderWithStudio } from "../../test/harness";
import { App } from "./App";

const REGIONS = ["Title bar", "Left pane", "Sheet", "Inspector", "Console"];

afterEach(async () => {
  await page.viewport(1440, 900);
});

describe("App", () => {
  for (const theme of ["shop", "draft"] as const) {
    test(`renders the five regions by name (${theme})`, async () => {
      await renderWithStudio(<App />, { theme });
      for (const name of REGIONS) {
        await expect.element(page.getByRole("region", { name, exact: true })).toBeVisible();
      }
      expect(document.documentElement.dataset.theme).toBe(theme);
    });
  }

  test("each region's view that isn't built yet says which work package builds it", async () => {
    await renderWithStudio(<App />);
    for (const name of REGIONS) await expect.element(page.getByRole("region", { name, exact: true })).toBeVisible();
    // Whichever neighbors have landed: every placeholder still showing in a region names its work package.
    const placeholders = [...document.querySelectorAll<HTMLElement>("[data-region] [data-placeholder]")].filter((el) =>
      el.checkVisibility(),
    );
    for (const placeholder of placeholders) expect(placeholder.textContent).toMatch(/Not built yet · WP-[A-Z0-9]+/);
  });

  test("Skip to sheet comes first in Tab order", async () => {
    await renderWithStudio(<App />);
    const first = document.querySelector<HTMLElement>("a, button, [tabindex='0'], input");
    expect(first?.textContent).toBe("Skip to sheet");
  });

  test("regions take focus for F6 cycling", async () => {
    await renderWithStudio(<App />);
    const sheet = page.getByRole("region", { name: "Sheet", exact: true });
    (sheet.element() as HTMLElement).focus();
    await expect.element(sheet).toHaveFocus();
  });

  test("the overlay modules that aren't built yet stay out of the layout", async () => {
    await renderWithStudio(<App />);
    await expect.element(page.getByRole("region", { name: "Sheet", exact: true })).toBeVisible();
    for (const text of ["Not built yet · WP-S6", "Not built yet · WP-S10"]) {
      expect(page.getByText(text).elements().every((el) => !(el as HTMLElement).checkVisibility())).toBe(true);
    }
  });
});
