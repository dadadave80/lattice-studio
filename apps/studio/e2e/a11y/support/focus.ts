/**
 * Focus checks: walking the Tab order, reading the focus ring each stop draws (spec L771: 2 px solid, outline and
 * never box-shadow), where focus sits, and what floats over the sheet (2.4.11).
 */
import type { Locator, Page } from "@playwright/test";
import { region } from "../../_support/keys.ts";

export type TabStop = {
  /** "[Title bar] button "Share"": the region, role and accessible name, for failure messages. */
  describe: string;
  outlineStyle: string;
  outlineWidth: number;
  visible: boolean;
};

/** The focused element, described and measured in the page. */
export async function focusedStop(page: Page): Promise<TabStop | null> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return null;
    let where = "";
    for (let node: Element | null = el; node; node = node.parentElement) {
      if (node.getAttribute("role") === "region" || node.tagName === "HEADER" || node.tagName === "ASIDE") {
        const label = node.getAttribute("aria-label");
        if (label) {
          where = label;
          break;
        }
      }
    }
    const role = el.getAttribute("role") ?? el.tagName.toLowerCase();
    const name = (el.getAttribute("aria-label") ?? el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
    const style = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    return {
      describe: `[${where || "page"}] ${role} "${name}"`,
      outlineStyle: style.outlineStyle,
      outlineWidth: Number.parseFloat(style.outlineWidth) || 0,
      visible: box.width > 0 && box.height > 0 && style.visibility !== "hidden",
    };
  });
}

/**
 * Tabs through the whole page from the top (or, with `fromHere`, from the focused element: inside a modal dialog)
 * until focus comes back to the first stop (or `limit` presses), and returns every stop in order.
 */
export async function tabStops(page: Page, options: { limit?: number; fromHere?: boolean } = {}): Promise<TabStop[]> {
  const { limit = 400, fromHere = false } = options;
  if (!fromHere) await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const stops: TabStop[] = [];
  for (let presses = 0; presses < limit; presses += 1) {
    await page.keyboard.press("Tab");
    const stop = await focusedStop(page);
    if (stop === null) continue;
    if (stops.length > 0 && stop.describe === stops[0]?.describe) break;
    stops.push(stop);
  }
  return stops;
}

/** Whether a stop draws the spec's ring: a solid (or double) outline at least 2 px wide. */
export function focusRing(stop: TabStop): { ok: boolean; why: string } {
  if (!stop.visible) return { ok: false, why: "focus is on an element with no box (2.4.7)" };
  if (stop.outlineStyle === "none" || stop.outlineStyle === "hidden") return { ok: false, why: "no outline (2.4.7)" };
  if (stop.outlineWidth < 2) return { ok: false, why: `outline ${stop.outlineWidth}px, under 2 px (2.4.13)` };
  return { ok: true, why: "" };
}

export type Rect = { x: number; y: number; width: number; height: number };

/** The visible elements that float over the sheet: its tool strip, zoom readout, title block and any toast. */
export function sheetFloats(page: Page): Locator[] {
  const sheet = region(page, "Sheet");
  return [
    sheet.getByRole("toolbar", { name: "Sheet tools" }),
    sheet.getByRole("button", { name: /^Zoom \d+%$/ }),
    sheet.getByRole("region", { name: "Title block" }),
    region(page, "Notifications").getByRole("status"),
    region(page, "Notifications").getByRole("alert"),
  ];
}

/** Every visible box among `locators` (each may match several elements, or none). */
export async function boxes(locators: readonly Locator[]): Promise<Rect[]> {
  const found: Rect[] = [];
  for (const locator of locators) {
    for (const one of await locator.all()) {
      const box = await one.boundingBox();
      if (box && box.width > 0 && box.height > 0 && (await one.isVisible())) found.push(box);
    }
  }
  return found;
}

/** The overlap of two rects in px² (0 when they don't touch). */
export function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}
