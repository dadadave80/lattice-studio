/**
 * The Inspector region (IR "Inspector"): the Catalog preview's Place on sheet (Flow 3 route 3) and the Facet
 * view's Requires list (Flow 3 route 6, spec L423).
 */
import type { Locator, Page } from "@playwright/test";
import { region } from "../../_support/keys.ts";

export class InspectorPage {
  readonly page: Page;
  readonly root: Locator;

  constructor(page: Page) {
    this.page = page;
    this.root = region(page, "Inspector");
  }

  /** Catalog preview (IR "Inspector"): Place on sheet. */
  get placeOnSheetButton(): Locator {
    return this.root.getByRole("button", { name: "Place on sheet" });
  }

  /**
   * Requires section (IR "Inspector", Flow 5): Place {option} for a missing requirement. Scoped to the
   * Requires `<section>` (an implicit `role="region"` named by its heading, S0's `Section`) rather than the
   * whole Inspector: an open facet's own unmet-requirement problem can render an identical "Place {option}"
   * button elsewhere in the view, and an unscoped lookup would be ambiguous.
   */
  placeRequirementButton(option: string): Locator {
    return this.root.getByRole("region", { name: "Requires" }).getByRole("button", { name: `Place ${option}` });
  }
}
