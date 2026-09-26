/**
 * The Console region (IR "Console drawer"): the log, the command line and the Export menu (spec L509-L518). Shared
 * by every Q1d spec that reads a console line or exports something.
 */
import { expect, type Locator, type Page } from "@playwright/test";
import { commandLine, region } from "../../_support/keys.ts";

/** The Console region (contracts `REGION_LABELS`). */
export function console_(page: Page): Locator {
  return region(page, "Console");
}

/** The console's log (`role="log"`): every line it prints, oldest first. */
export function log(page: Page): Locator {
  return page.getByRole("log");
}

/** Waits for a console line containing `text` (spec copy, quoted exactly; not a regex escape hatch). */
export async function expectLogLine(page: Page, text: string): Promise<void> {
  await expect(log(page).getByText(text, { exact: false })).toBeVisible();
}

/** The console's command line (the "›" prompt). Re-exported from `_support/keys.ts` for one import site. */
export { commandLine };

/** The Export menu's trigger button in the console header. */
export function exportTrigger(page: Page): Locator {
  return console_(page).getByRole("button", { name: "Export" });
}

/** Opens the Export menu (pointer) and returns its popup (role "menu", name "Export"). */
export async function openExportMenu(page: Page): Promise<Locator> {
  await exportTrigger(page).click();
  const menu = page.getByRole("menu", { name: "Export" });
  await expect(menu).toBeVisible();
  return menu;
}

/** Opens the Export menu with the keyboard (Enter on the focused trigger) and returns its popup. */
export async function openExportMenuByKeyboard(page: Page): Promise<Locator> {
  await exportTrigger(page).focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu", { name: "Export" });
  await expect(menu).toBeVisible();
  return menu;
}

/** An Export menu item by its short label ("Foundry script", "Agent brief", "Recipe JSON", "Project file", "Safe batch…", "Image"). */
export function exportItem(menu: Locator, label: string): Locator {
  return menu.getByRole("menuitem", { name: label });
}
