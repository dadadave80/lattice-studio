/**
 * The Sheet region for Flows 4-6 (spec L432-L455, IR "Sheet"): cards, pins, margin notes and the title block's
 * Deploy control. Roles and accessible names only (`_support/README.md`): a card is `role="group"` named
 * "{facet}, {n} selectors[, …]" (S4a's `cardName`); a pin is `role="button"` named "{signature} {hex}, {state}"
 * on the sheet, or "{signature} · {hex} {state}" in the inspector's Selectors list (`InspectorPage`); a note is
 * `role="note"` named its caption ("Selector collision · 2", "Missing dependency", "Convention").
 */
import { expect, type Locator, type Page } from "@playwright/test";
import { region } from "../../_support/keys.ts";

export class SheetPage {
  readonly root: Locator;

  constructor(private readonly page: Page) {
    this.root = region(page, "Sheet");
  }

  /** A facet's card, by its accessible name's leading "{facet}, ": `card("VaultCore")`. */
  card(facet: string): Locator {
    return this.root.getByRole("group", { name: new RegExp(`^${escapeRegExp(facet)}, `) });
  }

  /** The card's `data-border` (S4a: "default", "caution" the dashed one, or "conflict" the 2 px accent). Not a
   * selector — read only once the card is already found by role and name, the way the app itself computes it,
   * since a border has no textual accessible equivalent (contracts §6 "Card borders"). */
  async borderOf(facet: string): Promise<string | null> {
    return this.root.locator(`[data-facet="${facet}"]`).getAttribute("data-border");
  }

  /** A pin row on the sheet, by its exact accessible name: "sendMessage(bytes,bytes,bytes[]) 0xcdfe7f5c, routed". */
  pin(name: string): Locator {
    return this.root.getByRole("button", { name, exact: true });
  }

  /** A pin row on `facet`'s card, found by the selector's signature and state fragment (avoids escaping the
   * full hex/parens when a test only cares that the row exists in some state, e.g. "contested"). */
  pinLike(facet: string, fragment: string | RegExp): Locator {
    return this.card(facet).getByRole("button", { name: fragment });
  }

  /** A margin note, by its exact caption: "Selector collision · 2", "Missing dependency", "Convention", "Seam".
   * Exact, since "Selector collision" (one selector, no count) is a substring of "Selector collision · 2". */
  note(caption: string): Locator {
    return this.page.getByRole("note", { name: caption, exact: true });
  }

  /** Every open note's caption, in DOM order (F8 order), for asserting a note left after it resolved. */
  async noteCaptions(): Promise<string[]> {
    return this.page.getByRole("note").evaluateAll((notes) =>
      notes.map((n) => n.getAttribute("aria-labelledby")).map((id) => (id ? document.getElementById(id)?.textContent ?? "" : "")),
    );
  }

  /** The title block's Deploy… (or Deploy again…) control. */
  deployButton(): Locator {
    return this.page.getByRole("button", { name: /^Deploy(?: again)?…$/ });
  }

  /** A dependency trace's reason ("needs ERC4626"), read from the dependent card's accessible description
   * (IR "Dependency trace": "described in the card's description and in Structure", not a floating label
   * that needs zoom or hover to render). */
  async connectionsOf(facet: string): Promise<string> {
    const id = await this.card(facet).getAttribute("aria-describedby");
    if (!id) return "";
    return this.page.evaluate((elementId) => document.getElementById(elementId)?.textContent ?? "", id);
  }

  /** Selects `facet`'s card by clicking it (pointer path only; keyboard specs use ⌘/Ctrl+arrow or Tab). */
  async selectCard(facet: string): Promise<void> {
    await this.card(facet).click();
  }

  /** "+ n more" on a card collapsed past the expand threshold (S4a's `MoreButton`, spec L479): a row that
   * stopped being contested can end up tucked behind it, since C9 only guarantees contested rows stay visible
   * while collapsed. */
  async expandCard(facet: string): Promise<void> {
    await this.card(facet).getByRole("button", { name: /^\+ \d+ more$/ }).click();
  }

  /** ⇧1, Fit (IR "Keyboard"): brings every card into view. Tidy's layout can otherwise place a fixture's cards
   * outside the sheet's initial viewport, which React Flow's canvas doesn't scroll to on its own (it isn't a
   * native scroll container). Every spec calls this once right after seeding. */
  async fit(): Promise<void> {
    await this.page.keyboard.press("Shift+1");
  }

  /**
   * F8 to `caption`'s note (`navigate.ts`'s `focusProblem`/`reveal`): the one reliable way to bring a note into
   * view clear of the title bar and the console, since Fit's bounding box is the cards', not the notes' (a
   * note can sit above its card and still end up clipped under the title bar after Fit). Every note-button
   * interaction reveals its note this way first, pointer tests included: opening a project with an existing
   * problem never auto-scrolls to it either, so this also matches how a returning visitor would first reach it.
   */
  async revealNote(caption: string): Promise<Locator> {
    const note = this.note(caption);
    // `problem.next`'s run half is a dynamic import (S4c's `navigate.ts`, loaded on first use): the first F8 on
    // a fresh page waits on that chunk before it does anything, which can run past a short poll under load.
    // Pressing F8 again before a press's own note-focus request settles would skip a problem instead of
    // landing on its note, so each attempt gets a generous, individually awaited window.
    for (let presses = 0; presses < 15; presses += 1) {
      await this.page.keyboard.press("F8");
      try {
        await expect(note).toBeFocused({ timeout: 8000 });
        return note;
      } catch {
        // Not this problem (or the chunk was still loading): try the next F8.
      }
    }
    throw new Error(`F8 never focused the note "${caption}" within 15 presses.`);
  }

  // ── A collision note's own buttons (spec L435, S4c's `SetRouteButton`/`OwnerMenu`/`FixButton`) ────────────

  /** "Keep {facet}", the two-contender note's first button. */
  keepButton(note: Locator, facet: string): Locator {
    return note.getByRole("button", { name: `Keep ${facet}` });
  }

  /** "Route to {facet}", the two-contender note's second button. */
  routeButton(note: Locator, facet: string): Locator {
    return note.getByRole("button", { name: `Route to ${facet}` });
  }

  /** "Choose per selector…" or, for one selector with 3+ contenders, "Choose owner…". */
  choosePerSelectorButton(note: Locator): Locator {
    return note.getByRole("button", { name: /^Choose (?:per selector|owner)…$/ });
  }

  /** The three-or-more-contenders "Owner: {first} ▾" menu trigger. */
  ownerMenuTrigger(note: Locator): Locator {
    return note.getByRole("button", { name: /^Owner: / });
  }

  /** Opens the owner menu and chooses `facet` (a `menuitem`, unlike the dialog's `menuitemradio`). */
  async chooseOwnerFromMenu(note: Locator, facet: string): Promise<void> {
    await this.ownerMenuTrigger(note).click();
    await this.page.getByRole("menuitem", { name: facet }).click();
  }

  /** A note's fix button by its command title: "Place ERC4626", "Route to GovernedVault", "Remove ERC20Pausable". */
  fixButton(note: Locator, title: string): Locator {
    return note.getByRole("button", { name: title });
  }
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
