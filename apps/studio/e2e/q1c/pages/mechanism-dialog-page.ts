/**
 * Choose an upgrade mechanism (Flow 17, spec L640-L652; IR L175): the one dialog behind CORE-02's "Choose an
 * upgrade mechanism…", AUTH-01's "Use a Safe…" and "Use governance…", and the Authority table's Upgrade row.
 * Roles and accessible names only (IR "Dialogs"): the dialog traps Tab and closes on Esc, so every locator here
 * is scoped to its root.
 */
import { expect, type Locator, type Page } from "@playwright/test";

/** The dialog's own heading (`TITLE` in `ChooseMechanismDialog.tsx`), never the palette entry's "…" title. */
export const MECHANISM_DIALOG_TITLE = "Choose an upgrade mechanism";

export class MechanismDialogPage {
  readonly root: Locator;

  constructor(page: Page) {
    this.root = page.getByRole("dialog", { name: MECHANISM_DIALOG_TITLE });
  }

  async waitFor(): Promise<void> {
    await expect(this.root).toBeVisible();
  }

  /** One of the five choices, by its exact label ("Admin role", "Safe", "Safe with delay", "Governance", "Immutable"). */
  radio(label: string): Locator {
    return this.root.getByRole("radio", { name: label, exact: true });
  }

  /** AUTH-01's keep-the-mechanism checkbox (Admin role, reopened with `preset: "safe"`). */
  get keepCheckbox(): Locator {
    return this.root.getByRole("checkbox", { name: /^Use a Safe: keep AccessControlDiamondCut/ });
  }

  get safeAddressField(): Locator {
    return this.root.getByRole("textbox", { name: "Safe address" });
  }

  get thresholdField(): Locator {
    return this.root.getByRole("textbox", { name: "Minimum threshold" });
  }

  get delayField(): Locator {
    return this.root.getByRole("textbox", { name: "Delay" });
  }

  /** "This diamond" / "Deploying account" quick picks beside the Safe address field. */
  quickPick(label: "This diamond" | "Deploying account"): Locator {
    return this.root.getByRole("button", { name: label });
  }

  /** The "What changes" preview (spec L651): a list of `ChangeLine`s, backticks stripped by `CodeText`. */
  get preview(): Locator {
    return this.root.getByRole("region", { name: "What changes" });
  }

  /** The primary button, by its exact label ("Use SafeDiamondCut", "Keep immutable"). */
  applyButton(label: string): Locator {
    return this.root.getByRole("button", { name: label, exact: true });
  }

  get cancelButton(): Locator {
    return this.root.getByRole("button", { name: "Cancel" });
  }
}
