/**
 * The Browse all recipes dialog (Flow 2 step 1, spec L405-L407): every Lattice recipe in catalog order, v1's
 * three loadable, the rest "Arrives in v1.1".
 */
import type { Locator, Page } from "@playwright/test";

export class BrowseRecipesPage {
  readonly page: Page;
  readonly dialog: Locator;

  constructor(page: Page) {
    this.page = page;
    this.dialog = page.getByRole("dialog", { name: "Browse all recipes" });
  }

  row(name: string): Locator {
    return this.dialog.getByRole("listitem").filter({ has: this.page.getByText(name, { exact: true }) }).first();
  }

  loadButton(name: string): Locator {
    return this.dialog.getByRole("button", { name: `Load ${name}`, exact: true });
  }

  async close(): Promise<void> {
    await this.dialog.getByRole("button", { name: "Close" }).click();
  }
}
