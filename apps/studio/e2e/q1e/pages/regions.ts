/**
 * Page objects for the regions Flows 12-14 use: the title bar, the sheet's title block, the inspector's Chain
 * readiness and Deployments, the console log and the live regions. Roles and accessible names only (README.md).
 */
import { expect, type Locator, type Page } from "@playwright/test";
import { region } from "../../_support/keys.ts";

/** The title bar (spec L352): the status chip, and below 1024 px Deploy… (spec L366-L367). */
export class TitleBar {
  readonly root: Locator;
  constructor(readonly page: Page) {
    this.root = region(page, "Title bar");
  }
  /** The status chip, by the stamp it shows ("Live · Anvil · r1"). */
  chip(stamp: string): Locator {
    return this.root.getByRole("button", { name: stamp, exact: true });
  }
  deploy(): Locator {
    return this.root.getByRole("button", { name: "Deploy…", exact: true });
  }
  deployAgain(): Locator {
    return this.root.getByRole("button", { name: "Deploy again…", exact: true });
  }
  undo(): Locator {
    return this.root.getByRole("button", { name: "Undo", exact: true });
  }
}

/** The sheet's title block (spec L358): chain and path, address, stamp, counts, problems and Deploy…. */
export class TitleBlock {
  readonly root: Locator;
  constructor(readonly page: Page) {
    // A landmark inside the Sheet region, not one F6 cycles through (so not in the kit's `RegionName`).
    this.root = page.getByRole("region", { name: "Title block", exact: true });
  }
  chainAndPath(text: string): Locator {
    return this.root.getByRole("button", { name: `Chain and path: ${text}`, exact: true });
  }
  /** The stamp ("Not deployed", "Proposed · Anvil (Safe)", "Live · Anvil · r1", "Modified since r1", "Mismatch · Anvil"). */
  stamp(text: string | RegExp): Locator {
    return this.root.getByText(text, { exact: typeof text === "string" });
  }
  deploy(): Locator {
    return this.root.getByRole("button", { name: "Deploy…", exact: true });
  }
  deployAgain(): Locator {
    return this.root.getByRole("button", { name: "Deploy again…", exact: true });
  }
  compare(): Locator {
    return this.root.getByRole("button", { name: "Compare with the sheet…", exact: true });
  }
  /** "Predicted" or "Deployed", then the address in full (spec L358). */
  async addressLine(): Promise<{ label: string; address: string } | null> {
    const text = (await this.root.textContent()) ?? "";
    const match = /(Predicted|Deployed)\s?(0x[0-9a-fA-F]{40})/.exec(text);
    return match ? { label: match[1] ?? "", address: match[2] ?? "" } : null;
  }
}

/** The inspector's Diamond view: Chain readiness and the Deployments list (spec L697, Flow 13). */
export class Inspector {
  readonly root: Locator;
  constructor(readonly page: Page) {
    this.root = region(page, "Inspector");
  }
  readiness(): Locator {
    return this.root.getByRole("region", { name: "Chain readiness", exact: true });
  }
  deployments(): Locator {
    return this.root.getByRole("region", { name: "Deployments", exact: true });
  }
  /** One chain's group in the Deployments list. */
  deploymentsOn(chain: string): Locator {
    return this.deployments().getByRole("list", { name: `Deployments on ${chain}`, exact: true });
  }
}

/** The console's Log (spec L703-L728): each line is a button named "{tag} {text}". */
export class ConsoleLog {
  readonly root: Locator;
  constructor(readonly page: Page) {
    this.root = page.getByRole("log", { name: "Log", exact: true });
  }
  line(tag: string, text: string): Locator {
    return this.root.getByRole("button", { name: `${tag} ${text}`, exact: true });
  }
  lineMatching(tag: string, text: RegExp): Locator {
    return this.root.getByRole("button", { name: new RegExp(`^${tag} ${text.source}`) });
  }
}

/** Waits until a live region (status or alert) says `text`. */
export async function expectAnnounced(page: Page, text: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const said = [...(await page.getByRole("status").allTextContents()), ...(await page.getByRole("alert").allTextContents())];
        return said.some((line) => line.includes(text));
      },
      { message: `a live region should say "${text}"` },
    )
    .toBe(true);
}

/** The accessible description of a disabled control: its reason (spec L661, `aria-describedby`). */
export async function expectDisabledWith(control: Locator, reason: string): Promise<void> {
  await expect(control).toHaveAttribute("aria-disabled", "true");
  await expect(control).toHaveAccessibleDescription(reason);
}
