import { describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { settings } from "@/contracts";
import { renderWithStudio } from "../../../test/harness";
import { DeployGroup } from "./DeployGroup";

describe("DeployGroup", () => {
  test("renders every control, showing the current settings", async () => {
    await renderWithStudio(<DeployGroup />, {
      settings: { defaultPath: "createx", receiptTimeout: 60, deployAnnouncements: "all" },
    });
    await expect.element(page.getByRole("radio", { name: "CreateX CREATE3" })).toBeChecked();
    await expect.element(page.getByRole("textbox", { name: "Receipt timeout (seconds)" })).toHaveValue("60");
    await expect.element(page.getByRole("radio", { name: "Everything" })).toBeChecked();
    await expect
      .element(page.getByText("A project can switch paths in its deploy review, where the CreateX address scope is set too."))
      .toBeVisible();
  });

  test("changing default diamond path updates settings.defaultPath", async () => {
    await renderWithStudio(<DeployGroup />);
    await page.getByRole("radio", { name: "CreateX CREATE3" }).click();
    expect(settings.get().defaultPath).toBe("createx");
  });

  test("typing a valid receipt timeout commits it", async () => {
    await renderWithStudio(<DeployGroup />);
    await page.getByRole("textbox", { name: "Receipt timeout (seconds)" }).fill("300");
    expect(settings.get().receiptTimeout).toBe(300);
  });

  test("resyncs the receipt timeout field when the setting changes elsewhere (a reset, another tab)", async () => {
    await renderWithStudio(<DeployGroup />);
    const field = page.getByRole("textbox", { name: "Receipt timeout (seconds)" });
    await expect.element(field).toHaveValue("180");
    settings.set({ receiptTimeout: 45 });
    await expect.element(field).toHaveValue("45");
  });

  test("changing deploy announcements updates settings.deployAnnouncements", async () => {
    await renderWithStudio(<DeployGroup />);
    await page.getByRole("radio", { name: "Nothing" }).click();
    expect(settings.get().deployAnnouncements).toBe("none");
  });
});
