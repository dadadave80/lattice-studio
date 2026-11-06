/**
 * Menus and tooltip contents load after the first paint; tooltip triggers keep their native elements throughout.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "../_support/fixtures.ts";

async function holdPopups(page: Page): Promise<() => Promise<void>> {
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route(/\/assets\/popups-[^/]+\.js$/, async (route) => {
    await held;
    await route.continue();
  });
  return async () => {
    const ready = page.waitForResponse(/\/assets\/popups-[^/]+\.js$/);
    release();
    const response = await ready;
    await response.finished();
    await expect(page.getByRole("button", { name: "Lattice Studio" })).toHaveAttribute("aria-haspopup", "menu");
  };
}

test("the App menu's trigger is there before the popups chunk, and keeps focus when it arrives", async ({ page }) => {
  const release = await holdPopups(page);
  await page.goto("/");
  const trigger = page.getByRole("button", { name: "Lattice Studio" });
  await expect(trigger).toBeVisible();
  await expect(page.locator("[data-tooltip]")).toHaveCount(0);
  await trigger.focus();
  await release();
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("menu", { name: "App menu" })).toBeVisible();
});

test("a press on the App menu's trigger before the popups chunk opens the menu when it arrives", async ({ page }) => {
  const release = await holdPopups(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Lattice Studio" }).click();
  await expect(page.getByRole("menu", { name: "App menu" })).toHaveCount(0);
  await release();
  await expect(page.getByRole("menu", { name: "App menu" })).toBeVisible();
});

for (const input of ["pointer", "Space"] as const) {
  test(`popup readiness preserves a ${input} activation @smoke`, async ({ page }) => {
    const release = await holdPopups(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page.locator(".react-flow")).toBeVisible();
    const card = page.getByRole("button", { name: /^ERC20 / });
    await expect(card).not.toHaveAttribute("aria-disabled");
    const before = await card.elementHandle();
    if (!before) throw new Error("The startup recipe button is missing.");
    if (input === "pointer") {
      await card.hover();
      await page.mouse.down();
    } else {
      await card.focus();
      await page.keyboard.down("Space");
    }
    await release();
    const retained = await before.evaluate((button) => button.isConnected);
    if (input === "pointer") await page.mouse.up();
    else await page.keyboard.up("Space");
    expect(retained, "Loading tooltips must retain a pressed native control.").toBe(true);
    await expect(page.getByRole("log", { name: "Log" }).getByRole("button", { name: /Loaded ERC20/ })).toHaveCount(1);
  });
}

test("popup readiness preserves a focused input's draft, selection and next typing @smoke", async ({ page }) => {
  const release = await holdPopups(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.locator(".react-flow")).toBeVisible();
  await page.getByRole("button", { name: /^ERC20 / }).click();
  await page.getByRole("button", { name: "Edit setup", exact: true }).first().click();
  const name = page.getByRole("textbox", { name: "Name", exact: true });
  await name.fill("Library credits");
  await name.evaluate((input) => { if (input instanceof HTMLInputElement) input.setSelectionRange(2, 7); });
  const before = await name.elementHandle();
  if (!before) throw new Error("The recipe Name input is missing.");
  await release();
  const retained = await before.evaluate((input) => input.isConnected);
  const selection = await name.evaluate((input) => input instanceof HTMLInputElement ? [input.selectionStart, input.selectionEnd] : null);
  await page.keyboard.type("x");
  expect(retained, "Loading tooltips must retain the input being edited.").toBe(true);
  await expect(name).toBeFocused();
  expect(selection).toEqual([2, 7]);
  await expect(name).toHaveValue("Lix credits");
  await name.press("Enter");
  await expect(name).toHaveValue("Lix credits");
});
