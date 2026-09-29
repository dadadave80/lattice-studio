import { describe, expect, test } from "vitest";
import { cdp, page } from "vitest/browser";
import { settings, syncTheme } from "@/contracts";
import { onCleanup, renderWithStudio } from "../../../test/harness";
import { AppearanceGroup } from "./AppearanceGroup";

describe("AppearanceGroup", () => {
  test("renders Theme and Reduce motion, showing the current settings", async () => {
    await renderWithStudio(<AppearanceGroup />, { theme: "light", settings: { reduceMotion: "on" } });
    await expect.element(page.getByRole("group", { name: "Theme" })).toBeVisible();
    const options = page.getByRole("group", { name: "Theme" }).getByRole("button").elements();
    expect(options.map((b) => b.textContent)).toEqual(["Light", "Dark", "System"]);
    await expect.element(page.getByRole("button", { name: "Light" })).toHaveAttribute("aria-pressed", "true");
    await expect.element(page.getByRole("radiogroup", { name: "Reduce motion" })).toBeVisible();
    await expect.element(page.getByRole("radio", { name: "On" })).toBeChecked();
  });

  test("changing theme updates settings.theme", async () => {
    await renderWithStudio(<AppearanceGroup />);
    await page.getByRole("button", { name: "Light" }).click();
    expect(settings.get().theme).toBe("light");
  });

  test("changing reduce motion updates settings.reduceMotion", async () => {
    await renderWithStudio(<AppearanceGroup />);
    await page.getByRole("radio", { name: "Off" }).click();
    expect(settings.get().reduceMotion).toBe("off");
  });

  test("System follows the system's color scheme (spec L631), live", async () => {
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
    await expect.poll(() => document.documentElement.dataset.theme).toBe("light");
    await colorScheme("dark");
    await expect.poll(() => document.documentElement.dataset.theme).toBe("dark");
    await colorScheme("light");
    await expect.poll(() => document.documentElement.dataset.theme).toBe("light");
    // A chosen theme wins over the system's.
    await page.getByRole("button", { name: "Dark" }).click();
    await expect.poll(() => document.documentElement.dataset.theme).toBe("dark");
  });
});
