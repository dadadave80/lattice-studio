/**
 * The Console region's Log tab (IR "Console drawer"): `role="log"` named "Log", lines as buttons whose text is
 * the tag plus the message (`InlineCode` strips the backticks C10 renders around code, so assertions never
 * include a literal backtick). The Recipe JSON tab is a `role="tabpanel"` once selected.
 */
import { expect, type Locator, type Page } from "@playwright/test";
import { region, runConsole } from "../../_support/keys.ts";

export class ConsolePage {
  readonly root: Locator;
  readonly log: Locator;

  constructor(private readonly page: Page) {
    this.root = region(page, "Console");
    this.log = this.root.getByRole("log", { name: "Log" });
  }

  /** A log line by its full text (tag + message), as `LogLine` renders it: "Collision A and B both export …". */
  line(text: string | RegExp): Locator {
    return this.log.getByRole("button", { name: text });
  }

  /** The "›" command line (IR "Console drawer"). */
  commandLine(): Locator {
    return this.root.getByRole("textbox", { name: /command/i });
  }

  /** Types one console line and presses Enter, keyboard only (`_support/keys.ts`'s `runConsole`). */
  async run(line: string): Promise<void> {
    await runConsole(this.page, line);
  }

  /** Opens the Recipe JSON tab and returns its panel, read-only (IR "Console drawer"). */
  async recipeJson(): Promise<Locator> {
    await this.root.getByRole("tab", { name: "Recipe JSON" }).click();
    // Base UI's Tabs keep every panel mounted (Catalog's included), so `tabpanel` alone is ambiguous.
    const panel = this.page.getByRole("tabpanel", { name: "Recipe JSON" });
    await expect(panel).toBeVisible();
    return panel;
  }

  /** Back to the Log tab (the default; specs that opened Recipe JSON return here before more assertions). */
  async showLog(): Promise<void> {
    await this.root.getByRole("tab", { name: "Log", exact: true }).click();
  }
}
