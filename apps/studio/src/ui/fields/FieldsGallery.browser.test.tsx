import { afterEach, describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { renderWithStudio } from "../../../test/harness";
import { axeViolations as violations, emulateForcedColors as forcedColors } from "../testing/axe";
import { FieldsGallery } from "./FieldsGallery";

afterEach(async () => {
  await forcedColors(false);
});

async function renderGallery(theme: "dark" | "light"): Promise<Element> {
  const screen = await renderWithStudio(
    <main data-fields-gallery="">
      <FieldsGallery />
    </main>,
    { theme },
  );
  await expect.element(page.getByRole("heading", { name: "Number fields", level: 2 })).toBeVisible();
  const root = screen.container.querySelector("[data-fields-gallery]");
  if (!root) throw new Error("The gallery didn't render.");
  return root;
}

describe("FieldsGallery", () => {
  for (const theme of ["dark", "light"] as const) {
    test(`renders every field family and axe finds nothing in ${theme}`, async () => {
      const root = await renderGallery(theme);
      for (const name of [
        "Toggle buttons", "Segmented toggle", "Switches", "Checkboxes", "Radio groups", "Selects", "Text fields",
      ]) {
        await expect.element(page.getByRole("heading", { name, level: 2 })).toBeVisible();
      }
      expect(await violations(root)).toEqual([]);
    });

    test(`axe finds nothing in ${theme} with forced colors`, async () => {
      const root = await renderGallery(theme);
      await forcedColors(true);
      expect(matchMedia("(forced-colors: active)").matches).toBe(true);
      expect(await violations(root, { forced: true })).toEqual([]);
    });
  }

  test("every pointer target is at least 24 x 24 px", async () => {
    const root = await renderGallery("dark");
    const selector = [
      "button", "input:not([type=hidden])", "[role=button]", "[role=switch]", "[role=checkbox]", "[role=radio]",
      "[role=combobox]", "[tabindex='0']",
      // A label row around a small indicator is the target; a field label above its input isn't one.
      "label:has([role=switch], [role=checkbox], [role=radio])",
    ].join(",");
    const small: string[] = [];
    for (const el of root.querySelectorAll<HTMLElement>(selector)) {
      if (el.closest("[aria-hidden=true]")) continue;
      const rect = el.getBoundingClientRect();
      // Visually hidden native inputs behind a drawn control, and visually hidden labels, aren't targets.
      if (rect.width <= 1 || rect.height <= 1) continue;
      if (rect.width < 24 || rect.height < 24) {
        small.push(`${el.tagName.toLowerCase()} "${el.textContent?.trim().slice(0, 30)}" ${Math.round(rect.width)}x${Math.round(rect.height)}`);
      }
    }
    expect(small).toEqual([]);
  });
});
