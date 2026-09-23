/**
 * The gallery is the primitives' conformance floor (brief S0 "Done when"): axe with the WCAG 2.2 AA tags and
 * target-size on, in Shop, in Draft and with forced colors emulated; and every pointer target at least
 * 24 x 24 px (spec L770).
 */
import type AxeCore from "axe-core";
// Loaded as source, not through Vite's dependency optimizer: a first-time optimization reloads the page mid-run.
import axeSource from "axe-core/axe.min.js?raw";
import { afterEach, describe, expect, test } from "vitest";
import { cdp, page } from "vitest/browser";
import { renderWithStudio } from "../../../test/harness";
import { UiGallery } from "../UiGallery";

function loadAxe(): typeof AxeCore {
  const holder = window as unknown as { axe?: typeof AxeCore };
  if (!holder.axe) {
    const script = document.createElement("script");
    script.textContent = axeSource;
    document.head.append(script);
    script.remove();
  }
  if (!holder.axe) throw new Error("axe-core didn't load.");
  return holder.axe;
}

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/**
 * With forced colors the system palette replaces ours, so contrast is the user's choice; axe also misreads it
 * there (it resolves the authored text color against the forced Canvas). Every other rule still runs.
 */
async function violations({ forced = false } = {}): Promise<string[]> {
  const root = document.querySelector("[data-ui-gallery]");
  if (!root) throw new Error("The gallery didn't render.");
  const result = await loadAxe().run(root, {
    runOnly: { type: "tag", values: TAGS },
    rules: { "target-size": { enabled: true }, ...(forced ? { "color-contrast": { enabled: false } } : {}) },
    resultTypes: ["violations"],
  });
  return result.violations.flatMap((v) =>
    v.nodes.map((n) => `${v.id}: ${n.target.join(" ")} · ${n.failureSummary?.replace(/\s+/g, " ") ?? v.help}`),
  );
}

async function forcedColors(active: boolean): Promise<void> {
  await cdp().send("Emulation.setEmulatedMedia", {
    features: [{ name: "forced-colors", value: active ? "active" : "none" }],
  });
}

afterEach(async () => {
  await forcedColors(false);
});

async function renderGallery(theme: "shop" | "draft") {
  await renderWithStudio(<UiGallery />, { theme });
  await expect.element(page.getByRole("heading", { name: "Primitives", level: 1 })).toBeVisible();
}

describe("#/__ui gallery", () => {
  for (const theme of ["shop", "draft"] as const) {
    test(`axe finds nothing in ${theme}`, async () => {
      await renderGallery(theme);
      expect(await violations()).toEqual([]);
    });

    test(`axe finds nothing in ${theme} with forced colors`, async () => {
      await renderGallery(theme);
      await forcedColors(true);
      expect(matchMedia("(forced-colors: active)").matches).toBe(true);
      // The forced palette really applies (not just the media query).
      expect(getComputedStyle(document.documentElement).backgroundColor).not.toBe(
        theme === "shop" ? "rgb(12, 13, 15)" : "rgb(243, 241, 233)",
      );
      expect(await violations({ forced: true })).toEqual([]);
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
    for (const el of document.querySelectorAll<HTMLElement>(`[data-ui-gallery] :is(${selector})`)) {
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
