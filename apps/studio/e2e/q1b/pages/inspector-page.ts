/**
 * The Inspector region's Facet view (IR "Inspector"): a `<section aria-labelledby>` exposes an implicit
 * `role="region"` named its label ("Requires", "Selectors"), so every section is reachable the same way as the
 * top-level landmarks (`region()` in `_support/keys.ts`). A Requires row is a `<li>`; a Selectors row is a
 * button named "{signature} · {hex} {state in words}" (`SelectorRow`'s own text content, not an `aria-label`,
 * unlike the sheet's pins).
 */
import { type Locator, type Page } from "@playwright/test";
import { region } from "../../_support/keys.ts";

export class InspectorPage {
  readonly root: Locator;

  constructor(private readonly page: Page) {
    this.root = region(page, "Inspector");
  }

  /** A facet section by its label: "Requires", "Selectors", "Storage", "Init", "Release". */
  section(label: string): Locator {
    return this.root.getByRole("region", { name: label, exact: true });
  }

  /** A Requires row naming `option` ("ERC4626"), whichever status it's in. */
  requirement(option: string): Locator {
    return this.section("Requires").getByRole("listitem").filter({ hasText: option });
  }

  /** A Selectors list row, by a fragment of its signature or hex: "sendMessage", "0xcdfe7f5c". */
  selectorRow(fragment: string | RegExp): Locator {
    return this.section("Selectors").getByRole("button", { name: fragment });
  }

  /** The Selectors list's filter field (IR "Inspector"). */
  selectorFilter(): Locator {
    return this.section("Selectors").getByRole("textbox", { name: "Filter selectors" });
  }
}
