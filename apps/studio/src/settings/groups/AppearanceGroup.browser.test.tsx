import { describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { settings } from "@/contracts";
import { renderWithStudio } from "../../../test/harness";
import { AppearanceGroup } from "./AppearanceGroup";

describe("AppearanceGroup", () => {
  test("renders Theme and Reduce motion, showing the current settings", async () => {
    await renderWithStudio(<AppearanceGroup />, { theme: "draft", settings: { reduceMotion: "on" } });
    await expect.element(page.getByRole("group", { name: "Theme" })).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Draft" })).toHaveAttribute("aria-pressed", "true");
    await expect.element(page.getByRole("radiogroup", { name: "Reduce motion" })).toBeVisible();
    await expect.element(page.getByRole("radio", { name: "On" })).toBeChecked();
  });

  test("changing theme updates settings.theme", async () => {
    await renderWithStudio(<AppearanceGroup />);
    await page.getByRole("button", { name: "Draft" }).click();
    expect(settings.get().theme).toBe("draft");
  });

  test("changing reduce motion updates settings.reduceMotion", async () => {
    await renderWithStudio(<AppearanceGroup />);
    await page.getByRole("radio", { name: "Off" }).click();
    expect(settings.get().reduceMotion).toBe("off");
  });
});
