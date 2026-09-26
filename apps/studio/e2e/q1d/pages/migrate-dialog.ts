/**
 * The Migrate dialog (IR L178, spec L290, L504): the review of what moving to the build's catalog changes.
 * Title "Migrate", initial focus the summary (`data-migrate-summary`, `MigrateDialog.tsx`), footer
 * "Keep read-only" (an unbundled catalog) or "Cancel" (a bundled-but-different entry) plus the primary
 * "Migrate to {tag}" ("Migrate" alone while the catalogs are still loading).
 */
import { expect, type Locator, type Page } from "@playwright/test";

/** The dialog itself (role "dialog", labelled by its title "Migrate"). */
export function migrateDialog(page: Page): Locator {
  return page.getByRole("dialog", { name: "Migrate" });
}

/** Waits for the Migrate dialog to open and returns it. */
export async function expectMigrateDialog(page: Page): Promise<Locator> {
  const dialog = migrateDialog(page);
  await expect(dialog).toBeVisible();
  return dialog;
}

/** The review's summary line (`reviewSummary`, `MigrateReview.tsx`), focused when the review is ready. */
export function migrateSummary(page: Page): Locator {
  return migrateDialog(page).locator("[data-migrate-summary]");
}

/** The per-contract change list (`aria-label="Changes"`), when the review lists any. */
export function migrateChanges(page: Page): Locator {
  return migrateDialog(page).getByRole("list", { name: "Changes" });
}

/** "Keep read-only": shown once the pin is unbundled; closes without migrating. */
export function keepReadOnly(page: Page): Locator {
  return migrateDialog(page).getByRole("button", { name: "Keep read-only" });
}

/** "Cancel": shown for a bundled-but-different catalog entry; closes without migrating. */
export function migrateCancel(page: Page): Locator {
  return migrateDialog(page).getByRole("button", { name: "Cancel" });
}

/** The primary action once the review is ready: "Migrate to {tag}" (`catalogVersion(review.toTag)`). */
export function migrateTo(page: Page, tag: string): Locator {
  return migrateDialog(page).getByRole("button", { name: `Migrate to ${tag}`, exact: true });
}
