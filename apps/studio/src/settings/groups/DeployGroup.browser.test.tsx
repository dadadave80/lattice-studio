import { describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { settings } from "@/contracts";
import { onCleanup, renderWithStudio } from "../../../test/harness";
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

  test("an Etherscan API key is saved whole, on blur or Enter, never while it's being typed", async () => {
    await renderWithStudio(<DeployGroup />);
    const seen: string[] = [];
    onCleanup(settings.subscribe((state) => void seen.push(state.etherscanApiKey)));
    const field = page.getByRole("textbox", { name: "Etherscan API key" });
    await field.click();
    await userEvent.keyboard("ABC123");
    expect(settings.get().etherscanApiKey).toBe("");
    expect(seen).toEqual([]);
    await userEvent.keyboard("{Enter}");
    expect(settings.get().etherscanApiKey).toBe("ABC123");

    await field.fill(" XYZ789 ");
    expect(settings.get().etherscanApiKey).toBe("ABC123");
    await page.getByRole("radio", { name: "Nothing" }).click();
    expect(settings.get().etherscanApiKey).toBe("XYZ789");
    expect(seen.filter((key) => key !== "ABC123" && key !== "XYZ789")).toEqual([]);
  });

  test("clearing the Etherscan API key removes it, and the help says it isn't set up", async () => {
    await renderWithStudio(<DeployGroup />, { settings: { etherscanApiKey: "ABC123" } });
    const field = page.getByRole("textbox", { name: "Etherscan API key" });
    await expect.element(field).toHaveValue("ABC123");
    await expect.element(field).toHaveAccessibleDescription(
      "Verifies a diamond on Etherscan after a deploy, alongside Sourcify. The key stays in this browser and is sent only to Etherscan.",
    );
    await field.fill("");
    await userEvent.keyboard("{Enter}");
    expect(settings.get().etherscanApiKey).toBe("");
    await expect.element(field).toHaveAccessibleDescription(
      "Not set up. Verifies a diamond on Etherscan after a deploy, alongside Sourcify. The key stays in this browser and is sent only to Etherscan.",
    );
  });

  test("resyncs the Etherscan API key field when the setting changes elsewhere", async () => {
    await renderWithStudio(<DeployGroup />);
    settings.set({ etherscanApiKey: "FROM-ELSEWHERE" });
    await expect.element(page.getByRole("textbox", { name: "Etherscan API key" })).toHaveValue("FROM-ELSEWHERE");
  });
});
