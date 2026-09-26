/**
 * The Safe batch dialog (IR L180, spec L517, L580): asks for the Safe's address and the chain, then downloads
 * a Transaction Builder batch. Opens from the Export menu's "Safe batch…" item, from the overflow menu's Export
 * submenu, and from `export safe` with no arguments (`definitions.ts`'s `export.safe` run body opens it with
 * whatever it was given; `export safe <address> <chain>` with both skips it entirely). `SafeBatchDialog.tsx`:
 * title "Safe batch", initial focus the Safe address field, primary "Download batch", also "Cancel".
 */
import { expect, type Locator, type Page } from "@playwright/test";

/** `SafeBatchDialog.tsx`'s `SAFE_BATCH_TITLE`: the dialog's title and accessible name. */
export const SAFE_BATCH_TITLE = "Safe batch";
/** `SafeBatchDialog.tsx`'s `SAFE_ADDRESS_LABEL`: the address field's label. */
export const SAFE_ADDRESS_LABEL = "Safe address";
/** `SafeBatchDialog.tsx`'s `NOT_AN_ADDRESS`: the address field's error for anything that isn't one. */
export const NOT_AN_ADDRESS = "Enter the Safe's full address: 0x and 40 hex characters.";
/** `SafeBatchDialog.tsx`'s `DOWNLOAD_BATCH`: the primary button's label. */
export const DOWNLOAD_BATCH = "Download batch";

/** The dialog itself (role="dialog", named by its title). */
export function safeBatchDialog(page: Page): Locator {
  return page.getByRole("dialog", { name: SAFE_BATCH_TITLE });
}

/** The Safe address field. */
export function safeAddressField(page: Page): Locator {
  return safeBatchDialog(page).getByLabel(SAFE_ADDRESS_LABEL);
}

/** The chain select (`Select`'s trigger, role="combobox", named "Chain"). */
export function chainSelect(page: Page): Locator {
  return safeBatchDialog(page).getByRole("combobox", { name: "Chain" });
}

/** The primary action. */
export function downloadBatchButton(page: Page): Locator {
  return safeBatchDialog(page).getByRole("button", { name: DOWNLOAD_BATCH, exact: true });
}

/** The way out that loses nothing. */
export function cancelButton(page: Page): Locator {
  return safeBatchDialog(page).getByRole("button", { name: "Cancel", exact: true });
}

/** The failure banner shown after a submit that couldn't build the batch (`Banner tone="error"`). */
export function failureBanner(page: Page, text: string): Locator {
  return safeBatchDialog(page).getByText(text, { exact: false });
}

/** Types the Safe address (pointer or keyboard-focused field; `.fill` dispatches no pointer event). */
export async function fillSafeAddress(page: Page, address: string): Promise<void> {
  await safeAddressField(page).fill(address);
}

/** Picks `chainName` in the chain select with a click (`Select.tsx`'s pointer path). */
export async function chooseChain(page: Page, chainName: string): Promise<void> {
  await chainSelect(page).click();
  await page.getByRole("option", { name: chainName, exact: true }).click();
}

/**
 * Picks `chainName` with the keyboard only: focus, Enter opens, focus the option, Enter picks
 * (`Select.tsx`'s own doc: "Enter, Space or ↓ opens it, arrows move, Enter picks").
 */
export async function chooseChainByKeyboard(page: Page, chainName: string): Promise<void> {
  const trigger = chainSelect(page);
  await trigger.focus();
  await page.keyboard.press("Enter");
  const option = page.getByRole("option", { name: chainName, exact: true });
  await expect(option).toBeVisible();
  await option.focus();
  await page.keyboard.press("Enter");
}

/** Waits for the dialog to open, focused on the Safe address field (its documented initial focus). */
export async function expectOpen(page: Page): Promise<void> {
  await expect(safeBatchDialog(page)).toBeVisible();
  await expect(safeAddressField(page)).toBeFocused();
}

/** Waits for the dialog to close. */
export async function expectClosed(page: Page): Promise<void> {
  await expect(safeBatchDialog(page)).toHaveCount(0);
}
