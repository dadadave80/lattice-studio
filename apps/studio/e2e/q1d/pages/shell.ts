/**
 * The title bar (IR L60-L74, spec L355): the App menu, the save status, Share and the overflow menu ("More")
 * that swallows Share (and more) below 1024 px. Shared by every Q1d spec (Flows 10-11 touch all of it: Save,
 * Save a copy…, Open…, Share and, at narrow widths, Export move in here).
 */
import { expect, type Locator, type Page } from "@playwright/test";
import { region } from "../../_support/keys.ts";

/** The title bar region (contracts `REGION_LABELS`). */
export function titleBar(page: Page): Locator {
  return region(page, "Title bar");
}

/** Opens the App menu (the "Lattice Studio" / brand button) and returns its popup (role "menu", name "App menu"). */
export async function openAppMenu(page: Page): Promise<Locator> {
  await titleBar(page).getByRole("button", { name: "Lattice Studio" }).click();
  const menu = page.getByRole("menu", { name: "App menu" });
  await expect(menu).toBeVisible();
  return menu;
}

/** Opens the App menu with the keyboard (Enter on the focused trigger) and returns its popup. */
export async function openAppMenuByKeyboard(page: Page): Promise<Locator> {
  await titleBar(page).getByRole("button", { name: "Lattice Studio" }).focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu", { name: "App menu" });
  await expect(menu).toBeVisible();
  return menu;
}

/** An App menu item by its label ("Open…", "Save a copy…", "Projects", …). */
export function appMenuItem(menu: Locator, label: string): Locator {
  return menu.getByRole("menuitem", { name: label });
}

/** The "More" overflow menu's trigger (icon button), shown below 1024 px in place of Share, the theme and ⌘K. */
export function overflowTrigger(page: Page): Locator {
  return titleBar(page).getByRole("button", { name: "More" });
}

/** Opens the overflow menu and returns its popup. */
export async function openOverflowMenu(page: Page): Promise<Locator> {
  await overflowTrigger(page).click();
  const menu = page.getByRole("menu", { name: "More" });
  await expect(menu).toBeVisible();
  return menu;
}

/**
 * Runs Share (`share.copyLink`) however this viewport shows it: the title bar's own button at 1024 px and
 * wider, or the overflow menu's "Share" item below it. Pointer path.
 */
export async function clickShare(page: Page): Promise<void> {
  const direct = titleBar(page).getByRole("button", { name: "Share", exact: true });
  if (await direct.isVisible().catch(() => false)) {
    await direct.click();
    return;
  }
  const menu = await openOverflowMenu(page);
  await menu.getByRole("menuitem", { name: "Share" }).click();
}

/** The save status control (IR L66): "Saved", "Saving…", "Not saved" or "Read-only", as a button showing its text. */
export function saveStatusButton(page: Page): Locator {
  return titleBar(page).getByRole("button", { name: /^(Saved|Saving…|Not saved|Read-only)$/ });
}

/** Waits for the save status to read exactly `text` ("Saved", "Saving…", "Not saved", "Read-only"). */
export async function expectSaveStatus(page: Page, text: "Saved" | "Saving…" | "Not saved" | "Read-only"): Promise<void> {
  await expect(titleBar(page).getByRole("button", { name: text, exact: true })).toBeVisible();
}
