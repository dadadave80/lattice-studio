import { describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { renderWithStudio } from "../../test/harness";
import { App } from "./App";

const REGIONS = ["Title bar", "Left pane", "Sheet", "Inspector", "Console"];

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

  test("each unbuilt region says which work package builds it", async () => {
    await renderWithStudio(<App />);
    for (const [region, wp] of [
      ["Title bar", "S3"], ["Left pane", "S3"], ["Sheet", "S4b"], ["Inspector", "S5c"], ["Console", "S5e"],
    ] as const) {
      await expect
        .element(page.getByRole("region", { name: region, exact: true }).getByText(`Not built yet · WP-${wp}`))
        .toBeVisible();
    }
  });

  test("regions take focus for F6 cycling", async () => {
    await renderWithStudio(<App />);
    const sheet = page.getByRole("region", { name: "Sheet", exact: true });
    (sheet.element() as HTMLElement).focus();
    await expect.element(sheet).toHaveFocus();
  });
});
