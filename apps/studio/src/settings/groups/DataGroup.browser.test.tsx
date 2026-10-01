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
          "RPC providers see the addresses Studio reads, and Sourcify and Etherscan receive the sources they verify, which are public anyway.",
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

  test("says whether storage is persistent (spec L637)", async () => {
    testPersistence({
      storage: { persisted: async () => true, estimate: async () => ({ usage: 2048, quota: 1024 * 1024 }) },
    });
    await renderWithStudio(<DataGroup />);
    await expect.element(page.getByText("2.0 KB of 1.0 MB used", { exact: true })).toBeVisible();
    await expect.element(page.getByText("Persistent storage: on.", { exact: true })).toBeVisible();
  });

  test("says so when storage isn't persistent", async () => {
    testPersistence({ storage: { persisted: async () => false, estimate: async () => ({ usage: 0, quota: 1024 }) } });
    await renderWithStudio(<DataGroup />);
    await expect.element(page.getByText("Persistent storage: off.", { exact: true })).toBeVisible();
  });
});
