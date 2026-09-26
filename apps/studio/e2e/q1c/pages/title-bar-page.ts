/**
 * The title bar (IR L60-L74, spec L355): project name, save status, status chip, and Undo/Redo. At 1024 px and
 * wider Undo and Redo are icon buttons in the Title bar region; below 768 px (the phone tier) they move into the
 * "More" overflow menu (`OverflowMenu.tsx`, `partial={!phone}`), so this page object opens that menu first when
 * the buttons aren't directly visible.
 */
import { expect, type Locator, type Page } from "@playwright/test";
import { region } from "../../_support/keys.ts";

export class TitleBarPage {
  readonly root: Locator;

  constructor(private readonly page: Page) {
    this.root = region(page, "Title bar");
  }

  /** The project name control (rename in place, IR L66). */
  get projectName(): Locator {
    return this.root.getByRole("textbox", { name: /project name/i }).or(this.root.getByText(/.+/).first());
  }

  /** Opens the "More" overflow menu (phone tier only) and returns it (an APG menu). */
  private async openOverflow(): Promise<Locator> {
    const trigger = this.root.getByRole("button", { name: "More" });
    await trigger.click();
    const menu = this.page.getByRole("menu");
    await expect(menu).toBeVisible();
    return menu;
  }

  /**
   * The Undo control at the current viewport: the Title bar's icon button where it's shown directly, or the
   * overflow menu's "Undo" item at the phone tier. Callers press it with `.click()` (or keyboard-drive it, see
   * `undoKeyboard`); the accessible name is "Undo" either way (`CommandButton`'s `iconOnly` uses the command's
   * title, `TitledMenuItem` its `label`).
   */
  async undoControl(): Promise<Locator> {
    const direct = this.root.getByRole("button", { name: "Undo" });
    if (await direct.count()) return direct;
    const menu = await this.openOverflow();
    return menu.getByRole("menuitem", { name: "Undo" });
  }

  async redoControl(): Promise<Locator> {
    const direct = this.root.getByRole("button", { name: "Redo" });
    if (await direct.count()) return direct;
    const menu = await this.openOverflow();
    return menu.getByRole("menuitem", { name: "Redo" });
  }

  /** Clicks Undo (opening the overflow menu first at the phone tier). */
  async undo(): Promise<void> {
    await (await this.undoControl()).click();
  }

  async redo(): Promise<void> {
    await (await this.redoControl()).click();
  }

  /** The status chip, e.g. "Not deployed", "Live · Sepolia · r1" (IR L68). */
  get statusChip(): Locator {
    return this.root.getByText(/Not deployed|Proposed ·|Live ·|Modified since|Mismatch ·/);
  }
}
