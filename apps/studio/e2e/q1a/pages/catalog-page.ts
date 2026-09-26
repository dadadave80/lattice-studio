/**
 * The Left pane's Catalog tree (spec L356; IR "Left pane": Catalog), an APG tree. A row's accessible name is its
 * whole two-line content (name, count or "On sheet", namespace, chips), so callers match it with a regex anchored
 * at the start (S5a's `FacetRow`).
 */
import { expect, type Locator, type Page } from "@playwright/test";
import { region } from "../../_support/keys.ts";

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export class CatalogPage {
  readonly page: Page;
  readonly root: Locator;

  constructor(page: Page) {
    this.page = page;
    this.root = region(page, "Left pane");
  }

  get search(): Locator {
    return this.root.getByRole("textbox", { name: "Search" });
  }

  get tree(): Locator {
    return this.root.getByRole("tree", { name: "Catalog" });
  }

  /** A facet's row (unplaced or "On sheet"), by its exact name. Search first when the tree is long. */
  row(name: string): Locator {
    return this.tree.getByRole("treeitem", { name: new RegExp(`^${escapeRegExp(name)}(,| )`) });
  }

  /** Types into Search and waits for the row to be the only match (avoids "ERC20" matching "ERC20Votes"). */
  async searchFor(name: string): Promise<void> {
    await this.search.fill(name);
    await expect(this.row(name)).toBeVisible();
  }

  /** Route 2 (Flow 3): double-click a row to place it. */
  async placeByDoubleClick(name: string): Promise<void> {
    await this.searchFor(name);
    await this.row(name).dblclick();
  }

  /** Route 2 (Flow 3): focus a row and press Enter to place it. */
  async placeByKeyboard(name: string): Promise<void> {
    await this.searchFor(name);
    await this.row(name).focus();
    await this.page.keyboard.press("Enter");
  }

  /** Route 1 (Flow 3): drag a row onto the sheet at `x, y` (viewport coordinates). */
  async dragRowToSheet(name: string, target: { x: number; y: number }): Promise<void> {
    await this.searchFor(name);
    const row = this.row(name);
    const box = await row.boundingBox();
    if (!box) throw new Error(`${name}'s catalog row has no box to drag from.`);
    const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await this.page.mouse.move(start.x, start.y);
    await this.page.mouse.down();
    await this.page.mouse.move((start.x + target.x) / 2, (start.y + target.y) / 2, { steps: 5 });
    await this.page.mouse.move(target.x, target.y, { steps: 5 });
    await this.page.mouse.up();
  }
}
