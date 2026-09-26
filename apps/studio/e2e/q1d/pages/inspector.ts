/**
 * The Inspector region: the Diamond view's Deployments list (IR L119, spec L606) and the Confirm addresses…
 * view (IR L203, spec L334, L504). Shared by the two-tabs spec (a record written by the demoted tab) and the
 * share-link spec (LINK-01).
 */
import { expect, type Locator, type Page } from "@playwright/test";
import { region } from "../../_support/keys.ts";
import { runInPalette } from "./keys.ts";

/** The Inspector region (contracts `REGION_LABELS`). */
export function inspector(page: Page): Locator {
  return region(page, "Inspector");
}

/** Opens the Diamond view at its Deployments list (`deployments.show`) and waits for the list to take focus. */
export async function showDeployments(page: Page): Promise<void> {
  await runInPalette(page, "Show deployments");
  await expect(inspector(page).getByRole("heading", { level: 3, name: "Deployments" })).toBeVisible();
}

/**
 * One deployment record's row, by its address exactly as the record stores it (checksummed): the list item
 * carries `data-record="{chainId}:{address}"` (`DeploymentRecord.tsx`).
 */
export function deploymentRow(page: Page, chainId: number, address: string): Locator {
  return inspector(page).locator(`[data-record="${chainId}:${address}"]`);
}

/** Opens Confirm addresses… (`link.confirmAddresses`) and waits for its heading to take focus. */
export async function showConfirmAddresses(page: Page): Promise<void> {
  await runInPalette(page, "Confirm addresses");
  await expect(inspector(page).getByRole("heading", { level: 3, name: "Confirm addresses" })).toBeVisible();
}

/** The Confirm addresses view's current card: the field's label, the full address and the Confirm button. */
export function confirmCard(page: Page): Locator {
  return inspector(page).locator("[data-confirm-addresses]");
}
