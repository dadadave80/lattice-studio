/**
 * The Projects dialog (App menu → Projects, palette "Projects"; IR "Projects"): confirms a project that stayed
 * under Projects is still there (Flow 2 step 2, spec L408).
 */
import type { Locator, Page } from "@playwright/test";

export class ProjectsPage {
  readonly page: Page;
  readonly dialog: Locator;

  constructor(page: Page) {
    this.page = page;
    this.dialog = page.getByRole("dialog", { name: "Projects" });
  }

  row(name: string): Locator {
    return this.dialog.getByRole("button", { name, exact: true });
  }

  async close(): Promise<void> {
    await this.dialog.getByRole("button", { name: "Close" }).click();
  }
}
