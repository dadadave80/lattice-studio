/**
 * The Share dialog (IR L179, spec L503): opens instead of a direct copy when the link is over 2,000
 * characters. Title "Share", description names the exact character count, footer Cancel / Copy anyway /
 * Save a file instead (initial focus, `ShareDialog.tsx`).
 */
import { expect, type Locator, type Page } from "@playwright/test";

/** The dialog itself (role "dialog", labelled by its title "Share"). */
export function shareDialog(page: Page): Locator {
  return page.getByRole("dialog", { name: "Share" });
}

/** Waits for the Share dialog to open and returns it. */
export async function expectShareDialog(page: Page): Promise<Locator> {
  const dialog = shareDialog(page);
  await expect(dialog).toBeVisible();
  return dialog;
}

/** The dialog's description, exactly as `ShareDialog.tsx` writes it, for `characters`. */
export function shareDialogDescription(characters: number): string {
  return `This link is ${characters.toLocaleString("en-US")} characters, over the 2,000 a Discord message holds.`;
}

/** "Cancel": closes without copying or saving. */
export function shareDialogCancel(page: Page): Locator {
  return shareDialog(page).getByRole("button", { name: "Cancel" });
}

/** "Copy anyway": copies the full link and closes once the clipboard write settles. */
export function copyAnyway(page: Page): Locator {
  return shareDialog(page).getByRole("button", { name: "Copy anyway" });
}

/** "Save a file instead" (initial focus): downloads `recipe.json` through the console's export path. */
export function saveFileInstead(page: Page): Locator {
  return shareDialog(page).getByRole("button", { name: "Save a file instead" });
}
