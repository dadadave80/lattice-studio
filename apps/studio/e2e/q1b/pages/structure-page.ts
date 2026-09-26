/**
 * The Structure tree (IR "Left pane", spec L747): an APG tree named "Structure", in the Left pane region (or,
 * below 768 px, its own pane-switcher tab, see `expectTier`). Rows are `role="treeitem"`, named by S4a's card
 * and pin models so the tree and the sheet never drift: a facet "{facet}, {n} selectors[, …]", a selector
 * "{signature} {hex}, {state}", the Problems branch "Problems, {n}" or "Problems, none", and a problem
 * "{Severity}: {message}".
 */
import { expect, type Locator, type Page } from "@playwright/test";

export class StructurePage {
  readonly tree: Locator;

  constructor(private readonly page: Page) {
    this.tree = page.getByRole("tree", { name: "Structure" });
  }

  /** The Left pane defaults to its Catalog tab; Structure loads the first time this switches to it (S5b),
   * then stays mounted. Every spec that reads the tree opens it first. */
  async open(): Promise<void> {
    await this.page.getByRole("tab", { name: "Structure" }).click();
    await expect(this.tree).toBeVisible();
  }

  facet(name: string): Locator {
    return this.tree.getByRole("treeitem", { name: new RegExp(`^${escapeRegExp(name)}, `) });
  }

  selector(name: string | RegExp): Locator {
    return this.tree.getByRole("treeitem", { name });
  }

  problems(): Locator {
    return this.tree.getByRole("treeitem", { name: /^Problems, / });
  }

  problem(text: string | RegExp): Locator {
    return this.tree.getByRole("treeitem", { name: text });
  }
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
