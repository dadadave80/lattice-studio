import { describe, expect, test } from "vitest";
import { cdp, page } from "vitest/browser";
import { settings, syncTheme } from "@/contracts";
import { onCleanup, renderWithStudio } from "../../../test/harness";
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

  test("System follows the system's color scheme (spec L631): dark is Shop, light is Draft, live", async () => {
    const colorScheme = (value: "dark" | "light") =>
      cdp().send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value }] });
    onCleanup(async () => {
      await cdp().send("Emulation.setEmulatedMedia", { features: [] });
    });
    await colorScheme("light");
    await renderWithStudio(<AppearanceGroup />);
    onCleanup(syncTheme());
    await page.getByRole("button", { name: "System" }).click();
    expect(settings.get().theme).toBe("system");
    await expect.poll(() => document.documentElement.dataset.theme).toBe("draft");
    await colorScheme("dark");
    await expect.poll(() => document.documentElement.dataset.theme).toBe("shop");
    await colorScheme("light");
    await expect.poll(() => document.documentElement.dataset.theme).toBe("draft");
    // A chosen theme wins over the system's.
    await page.getByRole("button", { name: "Shop" }).click();
    await expect.poll(() => document.documentElement.dataset.theme).toBe("shop");
  });
});
