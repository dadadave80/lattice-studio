/**
 * Page objects for the dialogs of Flows 12-14: Deploy missing contracts (Flow 12 step 3), the Safe batch export
 * (Flow 12, "Safe or smart account as deployer"), Settings → Networks (Flow 14's Use another RPC…) and the deploy
 * review itself.
 */
import { expect, type Locator, type Page } from "@playwright/test";

/** Deploy missing contracts (spec L572, IR L232). */
export class MissingContractsDialog {
  readonly root: Locator;
  constructor(readonly page: Page) {
    this.root = page.getByRole("dialog", { name: "Deploy missing contracts", exact: true });
  }
  list(): Locator {
    return this.root.getByRole("list", { name: "Missing contracts", exact: true });
  }
  /** One contract's row. */
  row(name: string): Locator {
    return this.list().getByRole("listitem").filter({ hasText: name });
  }
  deploy(count: number): Locator {
    return this.root.getByRole("button", { name: `Deploy ${count} ${count === 1 ? "contract" : "contracts"}`, exact: true });
  }
  retry(name: string): Locator {
    return this.root.getByRole("button", { name: `Retry ${name}`, exact: true });
  }
}

/** Export → Safe batch… (spec L580). */
export class SafeBatchDialog {
  readonly root: Locator;
  constructor(readonly page: Page) {
    this.root = page.getByRole("dialog", { name: "Safe batch", exact: true });
  }
  safeAddress(): Locator {
    return this.root.getByRole("textbox", { name: "Safe address", exact: true });
  }
  download(): Locator {
    return this.root.getByRole("button", { name: "Download batch", exact: true });
  }
}

/** Settings, on its Networks tab (Flow 14: Use another RPC…). */
export class SettingsDialog {
  readonly root: Locator;
  constructor(readonly page: Page) {
    this.root = page.getByRole("dialog", { name: "Settings", exact: true });
  }
  rpcOverride(chain: string): Locator {
    return this.root.getByRole("textbox", { name: `${chain} RPC override`, exact: true });
  }
  close(): Locator {
    return this.root.getByRole("button", { name: "Close", exact: true });
  }
}

/**
 * Collects the page's React render-loop errors from now on (React #185, "getSnapshot should be cached"), so a review
 * that crashes as it opens fails with that reason instead of a bare timeout.
 */
export function watchReactErrors(page: Page): () => boolean {
  let crashed = false;
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (/Minified React error #185|Maximum update depth exceeded|getSnapshot should be cached/.test(text)) crashed = true;
  });
  return () => crashed;
}

/** The deploy review (Flow 12 step 2): a dialog named "Deploy {project}" with nine sections. */
export class DeployReview {
  readonly root: Locator;
  constructor(
    readonly page: Page,
    project: string,
  ) {
    this.root = page.getByRole("dialog", { name: `Deploy ${project}`, exact: true });
  }
  section(title: string): Locator {
    return this.root.getByRole("region", { name: title, exact: true });
  }
  sign(): Locator {
    return this.root.getByRole("button", { name: "Sign & deploy", exact: true });
  }
  /** The acknowledgement ticks (Checks, Authority): Keep example values, Cut without the registry check, … */
  acks(): Locator {
    return this.root.getByRole("checkbox");
  }
  /** Ticks every acknowledgement: a click each, or Tab to each and Space. */
  async tickAll(mode: "pointer" | "keyboard"): Promise<void> {
    await expect(this.acks().first()).toBeVisible();
    for (const box of await this.acks().all()) {
      if (mode === "pointer") {
        await box.check();
        continue;
      }
      for (let presses = 0; presses < 80 && !(await box.evaluate((el) => el === document.activeElement)); presses += 1) {
        await this.page.keyboard.press("Tab");
      }
      await expect(box).toBeFocused();
      await this.page.keyboard.press("Space");
      await expect(box).toBeChecked();
    }
  }
  /** Waits for the review to show; fails at once, saying so, if it crashed as it opened. */
  async expectOpen(crashed: () => boolean): Promise<void> {
    await expect.poll(async () => crashed() || (await this.root.isVisible()), { timeout: 15_000 }).toBe(true);
    expect(crashed(), "the deploy review crashed as it opened (React render loop)").toBe(false);
    await expect(this.root).toBeVisible();
  }
}

/** The nine sections of spec L562-L572, in order. */
export const REVIEW_SECTIONS = [
  "Network", "Deployer", "Address", "What gets cut", "Init", "Authority after deploy", "Checks", "Cost", "Simulation",
] as const;
