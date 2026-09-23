import { describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { settings } from "@/contracts";
import { renderWithStudio } from "../../../test/harness";
import { CanvasGroup } from "./CanvasGroup";

describe("CanvasGroup", () => {
  test("renders Scroll wheel, nudge fields and Show minimap, showing the current settings", async () => {
    await renderWithStudio(<CanvasGroup />, { settings: { wheel: "zoom", nudge: { small: 4, large: 16 }, minimap: true } });
    await expect.element(page.getByRole("group", { name: "Scroll wheel" })).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Zoom" })).toHaveAttribute("aria-pressed", "true");
    const small = page.getByRole("textbox", { name: "Small nudge" });
    const large = page.getByRole("textbox", { name: "Large nudge" });
    await expect.element(small).toHaveValue("4");
    await expect.element(large).toHaveValue("16");
    await expect.element(page.getByRole("switch", { name: "Show minimap" })).toBeChecked();
  });

  test("changing scroll wheel updates settings.wheel", async () => {
    await renderWithStudio(<CanvasGroup />);
    await page.getByRole("button", { name: "Zoom" }).click();
    expect(settings.get().wheel).toBe("zoom");
  });

  test("typing a valid nudge step commits it; invalid input is ignored", async () => {
    await renderWithStudio(<CanvasGroup />);
    const small = page.getByRole("textbox", { name: "Small nudge" });
    await small.fill("12");
    expect(settings.get().nudge.small).toBe(12);
    await small.fill("");
    expect(settings.get().nudge.small).toBe(12);
  });

  test("toggling Show minimap updates settings.minimap", async () => {
    await renderWithStudio(<CanvasGroup />);
    await page.getByRole("switch", { name: "Show minimap" }).click();
    expect(settings.get().minimap).toBe(true);
  });

  test("resyncs both nudge fields when the setting changes elsewhere (a reset, another tab)", async () => {
    await renderWithStudio(<CanvasGroup />);
    const small = page.getByRole("textbox", { name: "Small nudge" });
    const large = page.getByRole("textbox", { name: "Large nudge" });
    await expect.element(small).toHaveValue("8");
    await expect.element(large).toHaveValue("32");
    settings.set({ nudge: { small: 2, large: 10 } });
    await expect.element(small).toHaveValue("2");
    await expect.element(large).toHaveValue("10");
  });
});
