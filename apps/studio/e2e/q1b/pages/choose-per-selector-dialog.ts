/**
 * The Choose per selector dialog (spec L435, IR L176, `ChoosePerSelectorDialog.tsx`): one owner menu per
 * contested selector, then Apply owners as one undo step.
 */
import { expect, type Locator, type Page } from "@playwright/test";

export class ChoosePerSelectorDialogPage {
  readonly root: Locator;

  constructor(private readonly page: Page) {
    this.root = page.getByRole("dialog", { name: "Choose per selector" });
  }

  async expectOpen(): Promise<void> {
    await expect(this.root).toBeVisible();
  }

  /** The owner menu trigger for a selector's row: the trigger's own accessible name is just "Choose owner" or
   * "Owner: {facet}" (`OwnerChoice`'s `Menu` names the popup, not the button), so the row is found by its
   * signature text first. */
  ownerMenu(signature: string): Locator {
    return this.root.getByRole("listitem").filter({ hasText: signature }).getByRole("button");
  }

  /** Opens `signature`'s owner menu and chooses `facet` (a menuitemradio labelled with the facet's name). Base
   * UI keeps a closed menu's popup mounted, so `menuitemradio` alone can match more than one row's menu; this
   * scopes to the menu this signature's trigger names ("Owner of {signature}"). */
  async chooseOwner(signature: string, facet: string): Promise<void> {
    await this.ownerMenu(signature).click();
    await this.page.getByRole("menu", { name: `Owner of ${signature}` }).getByRole("menuitemradio", { name: facet }).click();
  }

  applyOwners(): Locator {
    return this.root.getByRole("button", { name: "Apply owners" });
  }

  cancel(): Locator {
    return this.root.getByRole("button", { name: "Cancel" });
  }
}
