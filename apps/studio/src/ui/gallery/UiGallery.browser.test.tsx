/**
 * The gallery is the primitives' conformance floor (brief S0 "Done when"): axe with the WCAG 2.2 AA tags and
 * target-size on, in Shop, in Draft and with forced colors emulated; and every pointer target at least
 * 24 x 24 px (spec L770).
 */
import { afterEach, describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { renderWithStudio } from "../../../test/harness";
import { axeViolations, emulateForcedColors } from "../testing/axe";
import { UiGallery } from "../UiGallery";

afterEach(async () => {
  await emulateForcedColors(false);
});

function galleryRoot(): Element {
  const root = document.querySelector("[data-ui-gallery]");
  if (!root) throw new Error("The gallery didn't render.");
  return root;
}

async function renderGallery(theme: "shop" | "draft") {
  await renderWithStudio(<UiGallery />, { theme });
  await expect.element(page.getByRole("heading", { name: "Primitives", level: 1 })).toBeVisible();
}

describe("#/__ui gallery", () => {
  for (const theme of ["shop", "draft"] as const) {
    test(`axe finds nothing in ${theme}`, async () => {
      await renderGallery(theme);
      expect(await axeViolations(galleryRoot())).toEqual([]);
    });

    test(`axe finds nothing in ${theme} with forced colors`, async () => {
      await renderGallery(theme);
      await emulateForcedColors(true);
      expect(matchMedia("(forced-colors: active)").matches).toBe(true);
      // The forced palette really applies (not just the media query).
      expect(getComputedStyle(document.documentElement).backgroundColor).not.toBe(
        theme === "shop" ? "rgb(12, 13, 15)" : "rgb(243, 241, 233)",
      );
      expect(await axeViolations(galleryRoot(), { forced: true })).toEqual([]);
    });
  }

  test("every pointer target is at least 24 x 24 px", async () => {
    await renderGallery("shop");
    const selector = [
      "button", "a[href]", "input:not([type=hidden])", "select", "textarea", "[role=button]", "[role=tab]",
      "[role=switch]", "[role=checkbox]", "[role=radio]", "[role=combobox]", "[role=treeitem]", "[role=menuitem]",
      "[role=separator][tabindex]", "[tabindex='0']",
    ].join(",");
    const small: string[] = [];
    for (const el of galleryRoot().querySelectorAll<HTMLElement>(`:is(${selector})`)) {
      if (el.closest("[aria-hidden=true], [inert]")) continue;
      const rect = el.getBoundingClientRect();
      // Visually hidden native inputs behind a drawn control (Base UI checkboxes, radios) aren't targets.
      if (rect.width <= 1 || rect.height <= 1) continue;
      if (rect.width < 24 || rect.height < 24) {
        small.push(`${el.tagName.toLowerCase()} "${el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 30)}" ${Math.round(rect.width)}x${Math.round(rect.height)}`);
      }
    }
    expect(small).toEqual([]);
  });

  test("shows every primitive family", async () => {
    await renderGallery("draft");
    for (const name of ["Buttons", "Keys", "Status", "Copy", "Icons (provisional)"]) {
      await expect.element(page.getByRole("heading", { name, level: 2 })).toBeVisible();
    }
    const sections = document.querySelectorAll("[data-gallery-section]").length;
    expect(sections).toBeGreaterThanOrEqual(8);
  });
});
