import { describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { session } from "@/contracts";
import { testPersistence } from "@/persist/testing";
import { renderWithStudio } from "../../../test/harness";
import { DataGroup } from "./DataGroup";

describe("DataGroup", () => {
  test("renders storage use, the privacy note and both data commands, now that S7b is live", async () => {
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
    const exportAll = page.getByRole("button", { name: "Export all projects" });
    const clear = page.getByRole("button", { name: "Clear data" });
    await expect.element(exportAll).toBeVisible();
    await expect.element(clear).toBeVisible();
    await expect.element(exportAll).not.toHaveAttribute("aria-disabled");
    await expect.element(clear).not.toHaveAttribute("aria-disabled");
    await clear.click();
    await expect.poll(() => session.get().dialogs.map((d) => d.id)).toEqual(["clear-data"]);
  });
});
