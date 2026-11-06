/**
 * The empty sheet's Start block draws and works before the canvas chunk arrives (Q19, `sheet/canvas/Sheet.tsx`).
 * When the canvas mounts its own block takes over, and the control a keyboard user had focused in the first one
 * keeps focus in the second, so the next Tab continues from there rather than from the page's top.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "../_support/fixtures.ts";

async function holdCanvas(page: Page): Promise<() => Promise<void>> {
  await page.clock.install();
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route(/\/assets\/SheetCanvas-[^/]+\.js$/, async (route) => {
    await held;
    await route.continue();
  });
  return async () => {
    const ready = page.waitForResponse(/\/assets\/SheetCanvas-[^/]+\.js$/);
    release();
    await (await ready).finished();
    // Flush React's delayed Suspense reveal while the physical activation is still pending.
    await page.clock.runFor(1000);
  };
}

for (const input of ["pointer", "Space"] as const) {
  test(`a ${input} activation survives the canvas becoming ready @smoke`, async ({ page }) => {
    const release = await holdCanvas(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const card = page.getByRole("button", { name: /^ERC20 / });
    await expect(card).not.toHaveAttribute("aria-disabled");
    if (input === "pointer") {
      await card.hover();
      await page.mouse.down();
    } else {
      await card.focus();
      await page.keyboard.down("Space");
    }
    await release();
    await expect(page.locator("[data-sheet-loading]")).toBeVisible();
    if (input === "pointer") await page.mouse.up();
    else await page.keyboard.up("Space");
    await page.clock.runFor(1);
    await expect(page.getByRole("log", { name: "Log" }).getByRole("button", { name: /Loaded ERC20/ })).toHaveCount(1);
    await expect(page.locator(".react-flow")).toBeVisible();
    await expect(page.locator("[data-chrome='start']")).toHaveCount(0);
  });
}

test("releasing outside a startup button cancels activation and lets the canvas take over @smoke", async ({ page }) => {
  const release = await holdCanvas(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const card = page.getByRole("button", { name: /^ERC20 / });
  await expect(card).not.toHaveAttribute("aria-disabled");
  await card.hover();
  await page.mouse.down();
  await release();
  await expect(page.locator("[data-sheet-loading]")).toBeVisible();
  await page.mouse.move(1, 1);
  await page.mouse.up();
  await page.clock.runFor(1);
  await expect(page.locator(".react-flow")).toBeVisible();
  await expect(page.getByRole("button", { name: /^ERC20 / })).toBeVisible();
  await expect(page.getByRole("log", { name: "Log" }).getByRole("button", { name: /Loaded ERC20/ })).toHaveCount(0);
});

for (const cancellation of ["pointercancel", "blur"] as const) {
  test(`${cancellation} releases a pending startup activation without loading a recipe @smoke`, async ({ page }) => {
    const release = await holdCanvas(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const card = page.getByRole("button", { name: /^ERC20 / });
    await expect(card).not.toHaveAttribute("aria-disabled");
    await card.evaluate((button) => button.addEventListener("pointerdown", (event) => {
      if (event instanceof PointerEvent) button.dataset.pointerId = String(event.pointerId);
    }, { once: true }));
    await card.hover();
    await page.mouse.down();
    await release();
    await expect(page.locator("[data-sheet-loading]")).toBeVisible();
    await card.evaluate((button, cancel) => {
      if (cancel === "blur") window.dispatchEvent(new Event("blur"));
      else window.dispatchEvent(new PointerEvent("pointercancel", { pointerId: Number(button.dataset.pointerId) }));
    }, cancellation);
    await page.clock.runFor(1);
    await expect(page.locator(".react-flow")).toBeVisible();
    await page.mouse.move(1, 1);
    await page.mouse.up();
    await expect(page.getByRole("button", { name: /^ERC20 / })).toBeVisible();
    await expect(page.getByRole("log", { name: "Log" }).getByRole("button", { name: /Loaded ERC20/ })).toHaveCount(0);
  });
}

test("a secondary pointer press does not hold canvas startup or load a recipe @smoke", async ({ page }) => {
  const release = await holdCanvas(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const card = page.getByRole("button", { name: /^ERC20 / });
  await card.hover();
  await page.mouse.down({ button: "right" });
  await release();
  await expect(page.locator(".react-flow")).toBeVisible();
  await page.mouse.up({ button: "right" });
  await expect(page.getByRole("log", { name: "Log" }).getByRole("button", { name: /Loaded ERC20/ })).toHaveCount(0);
});

test("a disabled startup button does not hold the canvas while Space is pressed @smoke", async ({ page }) => {
  const release = await holdCanvas(page);
  let releaseCatalog: () => void = () => {};
  const catalog = new Promise<void>((resolve) => { releaseCatalog = resolve; });
  await page.route("**/catalog/**", async (route) => { await catalog; await route.continue(); });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const card = page.getByRole("button", { name: /^ERC20 / });
  await expect(card).toHaveAttribute("aria-disabled", "true");
  await card.focus();
  await page.keyboard.down("Space");
  await release();
  await expect(page.locator(".react-flow")).toBeVisible();
  await page.keyboard.up("Space");
  await page.clock.runFor(1);
  await expect(page.getByRole("log", { name: "Log" }).getByRole("button", { name: /Loaded ERC20/ })).toHaveCount(0);
  releaseCatalog();
  await expect(card).not.toHaveAttribute("aria-disabled");
  await card.click();
  await expect(page.getByRole("log", { name: "Log" }).getByRole("button", { name: /Loaded ERC20/ })).toHaveCount(1);
});

for (const [phase, modifier] of [["keydown", false], ["keydown", true], ["keyup", false]] as const) {
  test(`a cancelled startup Space${modifier ? " shortcut" : " press"} on ${phase} releases the canvas @smoke`, async ({ page }) => {
    const release = await holdCanvas(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const card = page.getByRole("button", { name: /^ERC20 / });
    await expect(card).not.toHaveAttribute("aria-disabled");
    await card.evaluate((button, type) => button.addEventListener(type, (event) => {
      if (event instanceof KeyboardEvent && event.key === " ") event.preventDefault();
    }), phase);
    await card.focus();
    if (modifier) await page.keyboard.down("Control");
    await page.keyboard.down("Space");
    await release();
    await page.keyboard.up("Space");
    if (modifier) await page.keyboard.up("Control");
    await page.clock.runFor(1);
    await expect(page.locator(".react-flow")).toBeVisible();
    await expect(page.getByRole("log", { name: "Log" }).getByRole("button", { name: /Loaded ERC20/ })).toHaveCount(0);
  });
}

// Blank diamond, a recipe card, Browse all recipes and the tour link.
for (const control of ["Blank diamond", "ERC20", "Browse all recipes", "Take the 60-second tour"]) {
  test(`the Start block's focused control keeps focus when the canvas takes over (${control})`, async ({ page }) => {
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(/\/assets\/SheetCanvas-[^/]+\.js$/, async (route) => {
      await held;
      await route.continue();
    });
    await page.goto("/");

    const before = page.locator("[data-chrome='start'] button", { hasText: control });
    await expect(before).toBeVisible();
    await expect(page.locator(".react-flow")).toHaveCount(0);
    await before.focus();
    await expect(before).toBeFocused();

    release();
    await expect(page.locator(".react-flow [data-chrome='start']")).toBeVisible();
    await expect(page.locator(".react-flow [data-chrome='start'] button", { hasText: control })).toBeFocused();
    // The next Tab (back from the tour link, the block's last control) stays in the block.
    await page.keyboard.press(control.startsWith("Take") ? "Shift+Tab" : "Tab");
    await expect(page.locator(".react-flow [data-chrome='start'] :focus")).toHaveCount(1);
  });
}
