/**
 * Keyboard helpers (IR "Keyboard"): F6 regions, F8 problems, the ⌘K palette and console verbs. They press keys
 * and find controls by role and accessible name only, like every page object (README.md).
 *
 * `MOD` is Playwright's `ControlOrMeta`: ⌘ on macOS, Ctrl elsewhere, as Studio's `Mod` binds.
 */
import { expect, type Locator, type Page } from "@playwright/test";

export const MOD = "ControlOrMeta";

/**
 * The platform the page reports, read the way Studio reads it (S9's `currentPlatform`): "mac" binds ⌘ and leaves
 * out the Windows and Linux extras (Ctrl+F6, Ctrl+Y). Playwright's Desktop Chrome reports Windows, Desktop Safari
 * macOS.
 */
export async function pagePlatform(page: Page): Promise<"mac" | "other"> {
  return page.evaluate(() => {
    const data = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
    const name = data?.platform || navigator.platform || navigator.userAgent;
    return /mac|iphone|ipad|ipod/i.test(name) ? "mac" : "other";
  });
}

/** The region landmarks F6 cycles through (contracts `REGION_LABELS`), in order. */
export const REGIONS = ["Title bar", "Left pane", "Sheet", "Inspector", "Console"] as const;
export type RegionName = (typeof REGIONS)[number] | "Notifications";

/** A region landmark by its name. */
export function region(page: Page, name: RegionName): Locator {
  return page.getByRole("region", { name, exact: true });
}

/**
 * The name of the region that holds focus (the region itself after F6, or a control inside it), or null. Reads
 * the accessibility tree's role and label; no CSS.
 */
export async function focusedRegion(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    for (let node = document.activeElement; node; node = node.parentElement) {
      if (node.getAttribute("role") === "region") return node.getAttribute("aria-label");
    }
    return null;
  });
}

export type RegionKeyOptions = {
  /** Ctrl+F6 instead of F6, as Windows and Linux also bind (IR "Keyboard"). */
  ctrl?: boolean;
};

/** F6 (or Ctrl+F6): the next region. Returns the region focus landed in. */
export async function nextRegion(page: Page, options: RegionKeyOptions = {}): Promise<string | null> {
  await page.keyboard.press(options.ctrl ? "Control+F6" : "F6");
  return focusedRegion(page);
}

/** ⇧F6 (or Ctrl+⇧F6): the previous region. Returns the region focus landed in. */
export async function previousRegion(page: Page, options: RegionKeyOptions = {}): Promise<string | null> {
  await page.keyboard.press(options.ctrl ? "Control+Shift+F6" : "Shift+F6");
  return focusedRegion(page);
}

/** Presses F6 until `name` holds focus; fails after one full cycle. */
export async function focusRegion(page: Page, name: RegionName): Promise<void> {
  for (let presses = 0; presses <= REGIONS.length + 1; presses += 1) {
    if ((await focusedRegion(page)) === name) return;
    await page.keyboard.press("F6");
  }
  throw new Error(`F6 never reached the ${name} region.`);
}

/** F8: the next problem (its note takes focus, IR "Keyboard"). */
export async function nextProblem(page: Page): Promise<void> {
  await page.keyboard.press("F8");
}

/** ⇧F8: the previous problem. */
export async function previousProblem(page: Page): Promise<void> {
  await page.keyboard.press("Shift+F8");
}

/** The focused element's ARIA role, or null. */
async function focusedRole(page: Page): Promise<string | null> {
  return page.evaluate(() => document.activeElement?.getAttribute("role") ?? null);
}

/**
 * ⌘/Ctrl K, then waits for the palette's input (an APG combobox) to take focus. Returns it. Fails when the palette
 * doesn't open, for example over a modal dialog (IR "Command palette").
 */
export async function openPalette(page: Page): Promise<Locator> {
  await page.keyboard.press(`${MOD}+k`);
  await expect.poll(() => focusedRole(page), { message: "⌘K should focus the palette's combobox" }).toBe("combobox");
  const comboboxes = page.getByRole("combobox");
  for (let i = 0; i < (await comboboxes.count()); i += 1) {
    const candidate = comboboxes.nth(i);
    if (await candidate.evaluate((el) => el === document.activeElement)) {
      await expect(candidate).toBeFocused();
      return candidate;
    }
  }
  throw new Error("⌘K focused a combobox that the accessibility tree doesn't list.");
}

/** The text of the palette's active row (the combobox's `aria-activedescendant`), or null. */
async function activeOptionText(input: Locator): Promise<string | null> {
  return input.evaluate((el) => {
    const id = el.getAttribute("aria-activedescendant");
    const option = id ? document.getElementById(id) : null;
    return option?.textContent ?? null;
  });
}

/**
 * Runs a command through the palette: opens it, types `query`, waits until the active row is the one `query` names
 * (its title contains the query, case-insensitively) and presses Enter. Keyboard only. `query` should single out the
 * row: a command's title, "Connect wallet".
 */
export async function runInPalette(page: Page, query: string): Promise<void> {
  const input = await openPalette(page);
  await input.fill(query);
  await expect
    .poll(async () => (await activeOptionText(input))?.toLowerCase().includes(query.toLowerCase()) ?? false, {
      message: `the palette's active row should be "${query}"`,
    })
    .toBe(true);
  await page.keyboard.press("Enter");
}

/**
 * The console's command line (IR "Console drawer": the "›" prompt), inside the Console region. Its accessible name
 * contains "Command".
 */
export function commandLine(page: Page): Locator {
  return region(page, "Console").getByRole("textbox", { name: /command/i });
}

/**
 * Types one console line and presses Enter, keyboard only: F6 to the Console region, Tab to the command line when
 * it isn't focused yet. The console echoes it ("› place governor").
 */
export async function runConsole(page: Page, line: string): Promise<void> {
  const input = commandLine(page);
  const focused = async () => (await input.count()) === 1 && (await input.evaluate((el) => el === document.activeElement));
  if (!(await focused())) {
    await focusRegion(page, "Console");
    for (let presses = 0; presses < 20 && !(await focused()); presses += 1) await page.keyboard.press("Tab");
  }
  await expect(input).toBeFocused();
  await page.keyboard.type(line);
  await page.keyboard.press("Enter");
}
