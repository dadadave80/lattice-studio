import { describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { testPersistence } from "@/persist/testing";
import { renderWithStudio } from "../../../test/harness";
import { DataGroup } from "./DataGroup";

describe("DataGroup", () => {
  test("renders storage use, the privacy note and both data commands without crashing", async () => {
    testPersistence();
    await renderWithStudio(<DataGroup />);
    await expect
      .element(page.getByText(/ used$|isn't available in this browser\.$/))
      .toBeVisible();
    await expect
      .element(
        page.getByText(
          "RPC providers see the addresses Studio reads, and Sourcify receives the sources it verifies, which are public anyway.",
        ),
      )
      .toBeVisible();
    const exportAll = page.getByRole("button", { name: "data.exportAll" });
    const clear = page.getByRole("button", { name: "data.clear" });
    await expect.element(exportAll).toBeVisible();
    await expect.element(clear).toBeVisible();
    await expect.element(exportAll).toHaveAttribute("aria-disabled", "true");
    await expect.element(clear).toHaveAttribute("aria-disabled", "true");
    await expect.element(exportAll).toHaveAccessibleDescription("Not built yet · WP-S7b");
    await expect.element(clear).toHaveAccessibleDescription("Not built yet · WP-S7b");
  });
});
