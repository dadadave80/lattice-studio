/**
 * Focus around dialogs (spec L751-L761, WCAG 2.4.3): mark what had focus, open a dialog, check it took focus, close
 * it with Esc and check focus came back to that very element.
 */
import { expect, type Locator, type Page } from "@playwright/test";

const ORIGIN = "data-a11y-origin";

/** Marks the focused element, so the check after closing is about that very element, not one like it. */
export async function markOrigin(page: Page): Promise<void> {
  await page.evaluate((attr) => {
    document.querySelectorAll(`[${attr}]`).forEach((el) => el.removeAttribute(attr));
    const el = document.activeElement;
    if (!el || el === document.body) throw new Error("Nothing has focus to return to.");
    el.setAttribute(attr, "");
  }, ORIGIN);
}

/** "origin" when the marked element has focus, else what does ("body …"). */
export async function originFocused(page: Page): Promise<string> {
  return page.evaluate((attr) => {
    const el = document.activeElement;
    if (el?.hasAttribute(attr)) return "origin";
    const name = el ? (el.getAttribute("aria-label") ?? el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60) : "";
    return `${el?.tagName.toLowerCase() ?? "nothing"} "${name}"`;
  }, ORIGIN);
}

/** Whether focus is inside `popup`. */
export async function focusInside(popup: Locator): Promise<boolean> {
  return popup.evaluate((el) => el.contains(document.activeElement));
}

/** Presses Esc until `popup` is gone (a first Esc may only clear a query), at most three times. */
export async function closeWithEscape(page: Page, popup: Locator): Promise<void> {
  for (let presses = 0; presses < 3 && (await popup.count()) > 0; presses += 1) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(50);
  }
  await expect(popup).toHaveCount(0);
}

/**
 * Clicks the scrim around `dialog` (IR L188): a point near a corner of the viewport that the dialog's box doesn't
 * cover, so the press lands on the backdrop and nothing else.
 */
export async function clickScrim(page: Page, dialog: Locator): Promise<void> {
  const box = await dialog.boundingBox();
  const view = page.viewportSize();
  if (!box || !view) throw new Error("The dialog or the viewport has no box to click around.");
  const inset = 6;
  const corners = [
    { x: inset, y: view.height - inset },
    { x: view.width - inset, y: view.height - inset },
    { x: inset, y: inset },
    { x: view.width - inset, y: inset },
  ];
  const clear = corners.find(
    (p) => p.x < box.x || p.x > box.x + box.width || p.y < box.y || p.y > box.y + box.height,
  );
  if (!clear) throw new Error("The dialog covers every corner of the viewport, so there's no scrim to click.");
  await page.mouse.click(clear.x, clear.y);
}

/** From the focused element: opens `popup`, checks it takes focus, closes it with Esc and checks focus came back. */
export async function roundTrip(page: Page, open: () => Promise<void>, popup: Locator): Promise<void> {
  await markOrigin(page);
  await open();
  await expect(popup.first()).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => focusInside(popup.first()), { message: "the dialog takes focus" }).toBe(true);
  await closeWithEscape(page, popup);
  await expect.poll(() => originFocused(page), { message: "focus goes back to what opened it" }).toBe("origin");
}
