/**
 * Projects (IR "Projects" table, spec L502): the App menu's "Projects" item opens a dialog with two tabs,
 * "Recent" and "Recently deleted", each row's name, status chip and last-saved time, and its actions
 * (Rename, Duplicate, Export, Delete; Restore, Delete for good). Delete for good and Clear data each confirm
 * in their own dialog and count what goes (`DeleteForGoodDialogPanel.tsx`, `ClearDataDialogPanel.tsx`); Clear
 * data opens from Settings → Data (spec L502, L637), so its helpers live here too rather than in a fourth file.
 */
import { expect, type Locator, type Page } from "@playwright/test";
import { openAppMenu, openAppMenuByKeyboard, appMenuItem } from "./shell.ts";
import { runInPalette } from "./keys.ts";

// ── The Projects dialog ─────────────────────────────────────────────────────────────────────────────────

/** The "Projects" dialog. */
export function projectsDialog(page: Page): Locator {
  return page.getByRole("dialog", { name: "Projects" });
}

/** Opens Projects from the App menu (pointer path). */
export async function openProjectsDialog(page: Page): Promise<Locator> {
  const menu = await openAppMenu(page);
  await appMenuItem(menu, "Projects").click();
  const dialog = projectsDialog(page);
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Opens Projects from the App menu with the keyboard (Enter on the focused item). */
export async function openProjectsDialogByKeyboard(page: Page): Promise<Locator> {
  const menu = await openAppMenuByKeyboard(page);
  await appMenuItem(menu, "Projects").focus();
  await page.keyboard.press("Enter");
  const dialog = projectsDialog(page);
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Opens Projects however the palette reaches it (`project.list`), a second keyboard-only path. */
export async function openProjectsDialogFromPalette(page: Page): Promise<Locator> {
  await runInPalette(page, "Projects");
  const dialog = projectsDialog(page);
  await expect(dialog).toBeVisible();
  return dialog;
}

/** The "Recent" tab (its accessible name carries the row count, e.g. "Recent 2"). */
export function recentTab(page: Page): Locator {
  return projectsDialog(page).getByRole("tab", { name: /^Recent(?!ly)/ });
}

/** The "Recently deleted" tab (its accessible name carries the row count). */
export function deletedTab(page: Page): Locator {
  return projectsDialog(page).getByRole("tab", { name: /^Recently deleted/ });
}

/** Switches tabs by clicking (pointer path). */
export async function switchToTab(page: Page, tab: "recent" | "deleted"): Promise<void> {
  await (tab === "recent" ? recentTab(page) : deletedTab(page)).click();
}

// ── Recent rows ──────────────────────────────────────────────────────────────────────────────────────────

/**
 * One Recent row (`<li>`), found by its project name. Filters on the row's "Rename {name}" button, not the
 * plain name button: `ProjectRow.tsx` swaps the name button for a "Project name" textbox while renaming, but
 * its action buttons (Rename, Duplicate, Export, Delete) render unconditionally either way, so the row stays
 * findable through a rename.
 */
export function projectRow(page: Page, name: string): Locator {
  return projectsDialog(page).getByRole("listitem").filter({ has: page.getByRole("button", { name: `Rename ${name}` }) });
}

/** A Recent row's name button (click opens the project and closes the dialog, spec L502). */
export function rowNameButton(page: Page, name: string): Locator {
  return projectRow(page, name).getByRole("button", { name, exact: true });
}

/** Opens `name` from its Recent row (pointer path) and waits for the dialog to close. */
export async function openProjectRow(page: Page, name: string): Promise<void> {
  await rowNameButton(page, name).click();
  await expect(projectsDialog(page)).toHaveCount(0);
}

/** A Recent row's status chip text ("Not deployed", "Live · Sepolia · r1", …). */
export function rowStatusChip(page: Page, name: string): Locator {
  return projectRow(page, name).locator("[data-tone]");
}

/** Starts a rename (clicks the row's "Rename" button) and returns the field, focused. */
export async function startRenameRow(page: Page, name: string): Promise<Locator> {
  await projectRow(page, name).getByRole("button", { name: `Rename ${name}` }).click();
  const field = projectRow(page, name).getByRole("textbox", { name: "Project name" });
  await expect(field).toBeFocused();
  return field;
}

/** Renames a Recent row: opens the field, types `next`, commits with Enter. */
export async function renameRow(page: Page, name: string, next: string): Promise<void> {
  const field = await startRenameRow(page, name);
  await field.fill(next);
  await field.press("Enter");
}

/** Duplicates a Recent row. */
export async function duplicateRow(page: Page, name: string): Promise<void> {
  await projectRow(page, name).getByRole("button", { name: `Duplicate ${name}` }).click();
}

/** Exports a Recent row (downloads a `.lattice.json`); call alongside `page.waitForEvent("download")`. */
export async function exportRow(page: Page, name: string): Promise<void> {
  await projectRow(page, name).getByRole("button", { name: `Export ${name}` }).click();
}

/** Deletes a Recent row (no dialog: moves to Recently deleted with Undo in the toast, spec L502). */
export async function deleteRow(page: Page, name: string): Promise<void> {
  await projectRow(page, name).getByRole("button", { name: `Delete ${name}` }).click();
}

// ── Recently deleted rows ────────────────────────────────────────────────────────────────────────────────

/** One Recently deleted row (`<li>`), found by its project name (plain text, not a button, `TrashRow.tsx`). */
export function trashRow(page: Page, name: string): Locator {
  return projectsDialog(page)
    .getByRole("listitem")
    .filter({ has: page.getByText(name, { exact: true }) });
}

/** Restores a Recently deleted row. */
export async function restoreTrashRow(page: Page, name: string): Promise<void> {
  await trashRow(page, name).getByRole("button", { name: `Restore ${name}` }).click();
}

/** Opens Delete for good for a Recently deleted row. */
export async function clickDeleteForGood(page: Page, name: string): Promise<void> {
  await trashRow(page, name).getByRole("button", { name: `Delete ${name} for good` }).click();
}

// ── Delete for good (confirms; counts deployment records, spec L502) ───────────────────────────────────────

/** The "Delete for good" dialog. Its title carries the project's name once loaded ("Delete X for good"), so
 * it's found by its stable primary button instead of a title that starts blank. */
export function deleteForGoodDialog(page: Page): Locator {
  return page.getByRole("dialog").filter({ has: page.getByRole("button", { name: "Delete for good", exact: true }) });
}

export function deleteForGoodConfirmButton(page: Page): Locator {
  return deleteForGoodDialog(page).getByRole("button", { name: "Delete for good", exact: true });
}

export function deleteForGoodExportFirstButton(page: Page): Locator {
  return deleteForGoodDialog(page).getByRole("button", { name: "Export first" });
}

export function deleteForGoodCancelButton(page: Page): Locator {
  return deleteForGoodDialog(page).getByRole("button", { name: "Cancel" });
}

/** Confirms Delete for good and waits for it to close. The primary button starts disabled ("Counting
 * records…"), so this waits for it to enable before clicking. */
export async function confirmDeleteForGood(page: Page): Promise<void> {
  const button = deleteForGoodConfirmButton(page);
  await expect(button).toBeEnabled();
  await button.click();
  await expect(deleteForGoodDialog(page)).toHaveCount(0);
}

// ── Clear data (Settings → Data; confirms and counts, spec L502, L637) ─────────────────────────────────────

/** Opens Settings from the App menu and switches to the Data group. */
export async function openSettingsData(page: Page): Promise<Locator> {
  const menu = await openAppMenu(page);
  await appMenuItem(menu, "Settings").click();
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("tab", { name: "Data" }).click();
  return dialog;
}

/** Clicks "Clear data" in the Settings → Data group, opening its confirm dialog. */
export async function clickClearData(page: Page): Promise<Locator> {
  await openSettingsData(page);
  await page.getByRole("button", { name: "Clear data" }).click();
  const dialog = page.getByRole("dialog", { name: "Clear data" });
  await expect(dialog).toBeVisible();
  return dialog;
}

export function clearDataDialog(page: Page): Locator {
  return page.getByRole("dialog", { name: "Clear data" });
}

export function clearDataConfirmButton(page: Page): Locator {
  return clearDataDialog(page).getByRole("button", { name: "Delete everything" });
}

export function clearDataExportFirstButton(page: Page): Locator {
  return clearDataDialog(page).getByRole("button", { name: "Export first" });
}

export function clearDataCancelButton(page: Page): Locator {
  return clearDataDialog(page).getByRole("button", { name: "Cancel" });
}

/** Confirms Clear data ("Delete everything") once counting settles, and waits for it to close. */
export async function confirmClearData(page: Page): Promise<void> {
  const button = clearDataConfirmButton(page);
  await expect(button).toBeEnabled();
  await button.click();
  await expect(clearDataDialog(page)).toHaveCount(0);
}
