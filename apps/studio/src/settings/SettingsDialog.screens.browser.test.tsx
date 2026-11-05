import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { openDialog } from "@/contracts";
import { DialogHost } from "@/ui";
import { renderWithStudio } from "../../test/harness";

beforeAll(async () => { await document.fonts.ready; });
afterEach(async () => { await page.viewport(1440, 900); });

describe.each(["light", "dark"] as const)("phone Settings (%s)", (theme) => {
  for (const width of [320, 375]) {
    for (const group of ["data", "networks"] as const) {
      test(`${group} at ${width}px`, async () => {
        await page.viewport(width, 500);
        await renderWithStudio(<DialogHost />, { theme, settings: { reduceMotion: "on" } });
        openDialog("settings", { group });
        const dialog = page.getByRole("dialog", { name: "Settings" });
        const name = group === "data" ? "Data" : "Networks";
        await expect.element(page.getByRole("tab", { name })).toHaveAttribute("aria-selected", "true");
        if (group === "data") await expect.element(page.getByText(/Storage use isn't available|of .* used/)).toBeVisible();
        await document.fonts.ready;
        await expect.element(dialog).toMatchScreenshot(`settings-${group}-${width}-${theme}`);
      });
    }
  }
});
