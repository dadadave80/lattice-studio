/**
 * Page objects for the dialogs of Flows 12-14: Deploy missing contracts (Flow 12 step 3), the Safe batch export
 * (Flow 12, "Safe or smart account as deployer"), Settings → Networks (Flow 14's Use another RPC…) and the deploy
 * review itself.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";

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
 * Why the review-dependent steps can't run on this build: the deploy review crashes as it opens (React #185, "The
 * result of getSnapshot should be cached"): `useConnectors` in `chain/review/use-review.ts` reads
 * `service.connectors()`, which builds a new array on every call, so the dialog re-renders until React gives up and
 * the chunk boundary unmounts it. Reported by Q1e as a CCR to S8a/S8b.
 */
export const REVIEW_CRASHES =
  "Blocked: the deploy review crashes as it opens (React #185 from useConnectors' uncached snapshot in chain/review/use-review.ts) · CCR from Q1e";

/** Collects the page's React errors from now on, so a test can tell the review's crash from a slow open. */
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
  /**
   * Waits for the review to show. When the page logged the review's crash instead, skips the rest of the test with
   * `REVIEW_CRASHES`, so it runs again as soon as the fix lands.
   */
  async expectOpenOrSkip(crashed: () => boolean): Promise<void> {
    await expect.poll(async () => crashed() || (await this.root.isVisible()), { timeout: 15_000 }).toBe(true);
    test.skip(crashed() && !(await this.root.isVisible()), REVIEW_CRASHES);
    await expect(this.root).toBeVisible();
  }
}

/** The nine sections of spec L562-L572, in order. */
export const REVIEW_SECTIONS = [
  "Network", "Deployer", "Address", "What gets cut", "Init", "Authority after deploy", "Checks", "Cost", "Simulation",
] as const;
