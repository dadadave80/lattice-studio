import type AxeCore from "axe-core";
// Loaded as source, not through Vite's dependency optimizer (as in UiGallery.browser.test.tsx).
import axeSource from "axe-core/axe.min.js?raw";
import { afterEach, describe, expect, test } from "vitest";
import { cdp, page } from "vitest/browser";
import { renderWithStudio } from "../../../test/harness";
import { FieldsGallery } from "./FieldsGallery";

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

async function violations(root: Element, { forced = false } = {}): Promise<string[]> {
  const result = await loadAxe().run(root, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
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

async function renderGallery(theme: "shop" | "draft"): Promise<Element> {
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
  for (const theme of ["shop", "draft"] as const) {
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
    const root = await renderGallery("shop");
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
