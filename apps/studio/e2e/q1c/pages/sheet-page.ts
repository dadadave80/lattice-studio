/**
 * The Sheet region (IR "Sheet", spec Flow 8): cards, the tool strip, the zoom readout, notes and Back to
 * content. Shared by every Q1c spec that touches the sheet; a suite that needs something not here adds it and
 * says so in its report, rather than duplicating a near-identical locator in its own file.
 */
import { expect, type Locator, type Page } from "@playwright/test";
import { region } from "../../_support/keys.ts";

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export class SheetPage {
  readonly root: Locator;

  constructor(private readonly page: Page) {
    this.root = region(page, "Sheet");
  }

  /** A facet card by name (`FacetCard`'s group, whose name starts with "{name}, "). */
  card(name: string): Locator {
    return this.root.getByRole("group", { name: new RegExp(`^${escapeRegExp(name)}, `) });
  }

  /**
   * Whether `name`'s card is selected. A card `group` can't carry `aria-selected` (S4e's `selection.ts`), so
   * the state lives in its accessible description ("Selected." or "Not selected.", `describeCard`).
   */
  async isSelected(name: string): Promise<boolean> {
    const description = await this.card(name).evaluate((el) => {
      const id = el.getAttribute("aria-describedby");
      const target = id ? document.getElementById(id) : null;
      return target?.textContent ?? "";
    });
    return /(?:^|\s)Selected\./.test(description);
  }

  /** The card's bounding box in viewport pixels, or null off-screen. */
  async cardBox(name: string): ReturnType<Locator["boundingBox"]> {
    return this.card(name).boundingBox();
  }

  /** Right-clicks `name`'s card and returns its context menu (IR "Context menus": Card). */
  async cardMenu(name: string): Promise<Locator> {
    await this.card(name).click({ button: "right" });
    const menu = this.page.getByRole("menu");
    await expect(menu).toBeVisible();
    return menu;
  }

  /** The tool strip (an APG toolbar, IR L110). Hidden at the phone tier (moves to the overflow menu). */
  get toolStrip(): Locator {
    return this.page.getByRole("toolbar", { name: "Sheet tools" });
  }

  toolButton(label: string): Locator {
    return this.toolStrip.getByRole("button", { name: label });
  }

  /** The zoom readout button ("75%", IR L111); its menu offers 50%, 100%, 200%, Fit and Selection. */
  get zoomReadout(): Locator {
    return this.root.getByRole("button", { name: /^Zoom \d+%$/ });
  }

  async zoomText(): Promise<string> {
    const label = await this.zoomReadout.getAttribute("aria-label");
    return label?.replace(/^Zoom /, "") ?? "";
  }

  async openZoomMenu(): Promise<Locator> {
    await this.zoomReadout.click();
    const menu = this.page.getByRole("menu");
    await expect(menu).toBeVisible();
    return menu;
  }

  /** A note by its visible text (collision, seam, missing dependency or warning, IR "Note"). */
  note(text: string | RegExp): Locator {
    return this.root.getByText(text);
  }

  /** "Back to content", shown after 1 s with every card off-screen (spec L484). */
  get backToContent(): Locator {
    return this.root.getByRole("button", { name: "Back to content" });
  }
}
