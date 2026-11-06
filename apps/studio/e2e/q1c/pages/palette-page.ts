/** The shared keyboard path, retaining q1c's check that the combobox has finished closing. */
import { expect, type Page } from "@playwright/test";
import { runInPalette as runSharedPalette } from "../../_support/keys.ts";

export { openPalette } from "../../_support/keys.ts";

export async function runInPalette(page: Page, query: string): Promise<void> {
  await runSharedPalette(page, query);
  await expect(page.getByRole("combobox")).toHaveCount(0);
}
