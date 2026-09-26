/**
 * The Init plan view (Flow 7, spec L457-L469, IR L125): the bundle's locked form or the step list, the fields'
 * controls and dots, and the Authority table underneath. Every field kind (`AddressInput`, `DurationInput`,
 * `TextInput`) renders through Base UI's `Input`, so every field is a labelled `textbox` regardless of kind
 * (`apps/studio/src/panels/init/FieldControl.tsx`).
 */
import { expect, type Locator, type Page } from "@playwright/test";

export class InitPlanPage {
  readonly root: Locator;

  constructor(private readonly page: Page) {
    this.root = page.getByRole("region", { name: "Init plan" });
  }

  /** The plan's own "Fill in" button (`init.focusField` at the first missing required argument, INIT-01). */
  get fillIn(): Locator {
    return this.root.getByRole("button", { name: "Fill in" });
  }

  /** "Reorder steps automatically" (`init.reorderAuto`), shown only with 2+ movable steps (spec L467). */
  get reorderAuto(): Locator {
    return this.root.getByRole("button", { name: "Reorder steps automatically" });
  }

  /** A field's control by its label ("Asset", "Min delay", "Governor quorum", …): a labelled textbox. */
  field(label: string): Locator {
    return this.root.getByRole("textbox", { name: label });
  }

  /** A duration field's unit picker ("seconds", "minutes", "hours", "days", spec L463): a hidden-label Select
   * whose trigger reads "{label} unit" (`NumberField.tsx`), a Base UI combobox. */
  fieldUnit(label: string): Locator {
    return this.root.getByRole("combobox", { name: `${label} unit` });
  }

  /**
   * The field's accessible description (its help text and, once it has one, the dot's word "Example" or
   * "Set by you"), read through `aria-describedby` the way `SheetPage.isSelected` reads a card's description:
   * an accessibility relationship, not a CSS selector.
   */
  async fieldDescription(label: string): Promise<string> {
    return this.field(label).evaluate((el) => {
      const ids = (el.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean);
      return ids.map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
    });
  }

  /** A quick pick beside an address field ("This diamond", "Deploying account", "Zero address", spec L462). */
  quickPick(fieldLabel: string, pick: string): Locator {
    return this.root.getByRole("group", { name: `${fieldLabel} quick picks` }).getByRole("button", { name: pick });
  }

  /** A step card's heading, by its title: the init spec's name, or the automatic step's locked title. */
  stepHeading(title: string): Locator {
    return this.root.getByRole("heading", { name: title, level: 3 });
  }

  /**
   * The step card containing `title`'s heading (spec L467-L468): its ↑/↓ buttons and lock icon live here.
   * `filter({ has })` matches its inner locator against each candidate's own subtree, so the inner one must be
   * page-rooted (`this.stepHeading` is rooted at the region instead, an ancestor of every listitem, which
   * never matches as a descendant).
   */
  step(title: string): Locator {
    return this.root.getByRole("listitem").filter({ has: this.page.getByRole("heading", { name: title, level: 3 }) });
  }

  /** ↑ or ↓ on the step named `spec` (`MoveStepButton`'s "Move {spec} {direction}"). */
  moveStepButton(spec: string, direction: "up" | "down"): Locator {
    return this.root.getByRole("button", { name: `Move ${spec} ${direction}` });
  }

  /** The bundle's fixed internal order section ("Order inside {spec}", spec L460, L467). */
  get bundleOrderHeading(): Locator {
    return this.root.getByRole("heading", { name: /^Order inside /, level: 3 });
  }

  get bundleOrderNote(): Locator {
    return this.root.getByText("Fixed in Solidity, so it can't be reordered.");
  }

  /** The Authority table (spec L469): role → holder, with how each holder gets it and "Change who can upgrade…". */
  get authorityTable(): Locator {
    return this.root.getByRole("table", { name: "Authority" });
  }

  /** The `<tr>` for `role` ("DEFAULT_ADMIN_ROLE", "Upgrade", "Guardian", "Proposer", "Executor"), found from its
   * row header (a `th scope="row"`) and its parent row — an accessibility relationship, not a CSS selector. */
  private authorityRow(role: string): Locator {
    const header = this.authorityTable.getByRole("rowheader", { name: role, exact: true });
    return header.locator("xpath=..");
  }

  /**
   * The row's holder cell, split by line: `styles.holder` and `styles.via` are both block-level (spec L469), so
   * `innerText()` gives "This diamond\nGovernedVaultInit (the diamond itself)" (and a third line, the button's
   * label, on the Upgrade row).
   */
  private async authorityLines(role: string): Promise<string[]> {
    const text = await this.authorityRow(role).getByRole("cell").first().innerText();
    return text.split("\n");
  }

  /** The row's holder: "This diamond", "anyone", "none", or an address (spec L469). */
  async authorityHolder(role: string): Promise<string> {
    return this.authorityLines(role).then((lines) => lines[0] ?? "");
  }

  /** How the role's holder gets it, in the spec's own overlay words ("GovernedVaultInit (the diamond itself)"). */
  async authorityVia(role: string): Promise<string> {
    return this.authorityLines(role).then((lines) => lines[1] ?? "");
  }

  /** "Change who can upgrade…" (`authority.chooseMechanism`), shown only on the row that carries upgrade authority. */
  changeUpgradeButton(role: string): Locator {
    return this.authorityRow(role).getByRole("button", { name: "Change who can upgrade…" });
  }
}

/** Waits for the Init plan region to actually be on screen, wherever the tier put it (spec L367-L370). */
export async function expectInitPlanOpen(page: Page): Promise<InitPlanPage> {
  const plan = new InitPlanPage(page);
  await expect(plan.root).toBeVisible();
  return plan;
}
