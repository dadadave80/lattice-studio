/**
 * The Sheet region (spec L378, L413-L430; IR "Sheet"): the Start block (Flow 1-2) and placed cards (Flow 3).
 * Roles and accessible names only (README.md): a card is a `role="group"` labelled by its facet name (S4a's
 * `facetNodeA11y`, `cardNameId`); the accessible name is "Name" or "Name, …" once the card has connections or
 * problems to describe, so callers match it with a regex anchored at the start.
 */
import { expect, type Locator, type Page } from "@playwright/test";
import { region } from "../../_support/keys.ts";

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export class SheetPage {
  readonly page: Page;
  readonly root: Locator;

  constructor(page: Page) {
    this.page = page;
    this.root = region(page, "Sheet");
  }

  /** A placed facet's card, by its exact name (S4a: "Name" or "Name, …"). */
  card(name: string): Locator {
    return this.root.getByRole("group", { name: new RegExp(`^${escapeRegExp(name)}(,|$)`) });
  }

  /** The empty sheet's Start block (spec L378, IR L108). */
  get startTitle(): Locator {
    return this.root.getByRole("heading", { name: "Start a diamond" });
  }

  get blankDiamondButton(): Locator {
    return this.root.getByRole("button", { name: "Blank diamond", exact: true });
  }

  /** One of v1's recipe cards ("GovernedVault", "ERC20", "SafeDiamondCut"), spec L405. */
  recipeCard(name: string): Locator {
    return this.root.getByRole("button", { name: new RegExp(`^${escapeRegExp(name)}`) });
  }

  get browseAllRecipesButton(): Locator {
    return this.root.getByRole("button", { name: "Browse all recipes" });
  }

  get tourLink(): Locator {
    return this.root.getByRole("button", { name: "Take the 60-second tour" });
  }

  get tourHint(): Locator {
    return this.root.getByText("New here?");
  }

  /** A margin note (collision, seam, missing dependency, warning), by its caption (IR "Sheet": Note). */
  note(caption: string): Locator {
    return this.page.getByRole("note", { name: caption });
  }

  /** The title block's "n parameter(s) to fill" text (Flow 2 step 5, spec L411). */
  get parametersToFill(): Locator {
    return this.root.getByText(/parameters? to fill/);
  }

  get fillInButton(): Locator {
    return this.root.getByRole("button", { name: "Fill in" });
  }

  /**
   * Waits until `name`'s card is on screen, selected (spec L427: placing selects). The card's own accessible
   * description ends "Selected." once it is (S4a's `describeCard`; the `data-selected` attribute lives on
   * `FacetCard`'s inner paint div, not the `role=group` node this locates, so it can't be read from here).
   */
  async expectSelected(name: string): Promise<void> {
    const card = this.card(name);
    await expect(card).toBeVisible();
    await expect(card).toHaveAccessibleDescription(/Selected\.$/);
  }
}
