/**
 * Save a copy… (IR "Save a copy" dialog, spec L497): File name field, Save primary, Cancel. Opens with a linked
 * file's name (`SaveCopyDialogPanel.tsx`) or nothing linked yet, from ⌘S with no linked file, the App menu's
 * "Save a copy…", or `export project`.
 */
import { expect, type Locator, type Page } from "@playwright/test";

/** The "Save a copy" dialog (role "dialog"). */
export function saveCopyDialog(page: Page): Locator {
  return page.getByRole("dialog", { name: "Save a copy" });
}

/** Waits for the dialog to open. */
export async function expectSaveCopyDialog(page: Page): Promise<Locator> {
  const dialog = saveCopyDialog(page);
  await expect(dialog).toBeVisible();
  return dialog;
}

/** The "File name" field, pre-filled with the project's export filename. */
export function fileNameField(page: Page): Locator {
  return saveCopyDialog(page).getByLabel("File name");
}

/** Reads the field's current value. */
export function fileName(page: Page): Promise<string> {
  return fileNameField(page).inputValue();
}

/** Replaces the field's value. */
export async function setFileName(page: Page, name: string): Promise<void> {
  await fileNameField(page).fill(name);
}

/** The primary "Save" button. */
export function saveButton(page: Page): Locator {
  return saveCopyDialog(page).getByRole("button", { name: "Save" });
}

/** The "Cancel" button. */
export function cancelButton(page: Page): Locator {
  return saveCopyDialog(page).getByRole("button", { name: "Cancel" });
}

/** Clicks Save and waits for the dialog to close (a successful save, never cancelled). */
export async function clickSave(page: Page): Promise<void> {
  await saveButton(page).click();
  await expect(saveCopyDialog(page)).toHaveCount(0);
}

/** Presses Enter in the File name field, the dialog's own submit shortcut (`SaveCopyDialogPanel.tsx`). */
export async function submitWithEnter(page: Page): Promise<void> {
  await fileNameField(page).press("Enter");
}

/** Clicks Cancel and waits for the dialog to close. */
export async function clickCancel(page: Page): Promise<void> {
  await cancelButton(page).click();
  await expect(saveCopyDialog(page)).toHaveCount(0);
}
