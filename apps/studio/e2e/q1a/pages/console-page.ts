/**
 * The Console region (spec L919 IR "Console drawer"): the log (`role="log"`, one button per line) and the
 * command line. Keyboard entry goes through `../../_support/keys.ts`'s `runConsole`; this page only reads.
 */
import { expect, type Locator, type Page } from "@playwright/test";
import { region } from "../../_support/keys.ts";

export class ConsolePage {
  readonly page: Page;
  readonly root: Locator;

  constructor(page: Page) {
    this.page = page;
    this.root = region(page, "Console");
  }

  get log(): Locator {
    return this.root.getByRole("log", { name: "Log" });
  }

  /**
   * One log line, by the spec's exact wording (the line's text; its accessible name also repeats its tag word
   * first, so this matches as a substring, never `exact`).
   */
  line(text: string): Locator {
    return this.log.getByRole("button", { name: text });
  }

  /** Waits until `text` is on some line of the log (auto-scroll keeps the newest one in view). */
  async expectLine(text: string): Promise<void> {
    await expect(this.line(text)).toBeVisible();
  }

  /** Waits until `text` is in the log's last line: nothing the command narrated afterward follows it. */
  async expectLastLine(text: string): Promise<void> {
    await expect(this.log.getByRole("button").last()).toHaveAccessibleName(within(text));
  }

  /** Waits until `text` is in the log's first line: on a first visit, the catalog line (spec L401). */
  async expectFirstLine(text: string): Promise<void> {
    await expect(this.log.getByRole("button").first()).toHaveAccessibleName(within(text));
  }
}

/** A line's accessible name repeats its tag word first, so the spec's wording is matched as a substring. */
function within(text: string): RegExp {
  return new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}
