/**
 * The states the accessibility suite checks (the Q2 brief's list, spec L795-L797), each reached from a seeded
 * project with the keyboard only, and the themes and media emulations every state is checked under.
 */
import { expect, type BrowserContext, type Locator, type Page } from "@playwright/test";
import type { ThemeChoice } from "../../../src/contracts/stores.ts";
import { focusRegion, focusedRegion, region } from "../../_support/keys.ts";
import { collisionsProject, recipeProject } from "../../_support/projects.ts";
import { openEmpty, seedProject, seedSettings } from "../../_support/seed.ts";
import { isFocused, openPalette, paletteInput, runInPalette, tabTo, waitForSheet } from "./keyboard.ts";

/** The two themes Studio draws (spec: Shop and Draft); `system` resolves to one of them. */
export const THEMES = ["shop", "draft"] as const satisfies readonly ThemeChoice[];
export type Theme = (typeof THEMES)[number];

/** Seeds the theme before the app's first script runs. Call before the first `page.goto`. */
export async function seedTheme(context: BrowserContext, theme: Theme): Promise<void> {
  await seedSettings(context, { theme });
}

/** The page draws `theme` (the shell's stable `data-theme` hook on `<html>`). */
export async function expectTheme(page: Page, theme: Theme): Promise<void> {
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
}

type Media = Parameters<Page["emulateMedia"]>[0];

export type Emulation = {
  name: string;
  media: Media;
  /** axe rules that can't judge this emulation, each with the reason (kept in the failure message). */
  disable?: Record<string, string>;
};

const NEUTRAL: Media = { forcedColors: "none", reducedMotion: "no-preference", contrast: "no-preference" };

/** No preference, then forced colors, reduced motion and more contrast (spec L784-L786). */
export const EMULATIONS: readonly Emulation[] = [
  { name: "no preference", media: NEUTRAL },
  {
    name: "forced colors",
    media: { ...NEUTRAL, forcedColors: "active" },
    disable: {
      // As S6's `src/ui/testing/axe.ts`: the system palette replaces the tokens, and axe resolves the authored text
      // color against the forced Canvas, so its contrast numbers describe colors nobody sees. Every other rule runs.
      "color-contrast": "forced colors replace the palette with system colors",
    },
  },
  { name: "reduced motion", media: { ...NEUTRAL, reducedMotion: "reduce" } },
  { name: "more contrast", media: { ...NEUTRAL, contrast: "more" } },
];

export type AppState = {
  name: string;
  /** Opens the app (after the theme is seeded) and reaches the state, keyboard only once it has loaded. */
  reach(page: Page): Promise<void>;
  /**
   * A modal state checks its dialog only: the page behind it is inert and dimmed by the backdrop, so axe would
   * measure blended colors nobody reads (the page itself is checked in the other states).
   */
  scope?(page: Page): Locator;
};

/** The one open modal dialog. */
function openDialog(page: Page): Locator {
  return page.getByRole("dialog");
}

/** The sheet's first card, as Tab reaches it: a group named "{facet}, {n} selectors…" (spec L745). */
export function cards(page: Page) {
  return region(page, "Sheet").getByRole("group", { name: / \d+ selectors?/ });
}

/**
 * Puts keyboard focus on a card: F6 to the Sheet (which lands on the region, or back on the element the sheet last
 * focused), then Tab onto the card grid's stop when focus isn't on a card yet (spec L744: the grid comes first).
 */
export async function focusFirstCard(page: Page): Promise<void> {
  const onCard = () => page.evaluate(() => document.activeElement?.getAttribute("role") === "group");
  await focusRegion(page, "Sheet");
  if (!(await onCard())) await page.keyboard.press("Tab");
  await expect.poll(onCard, { message: "a card takes focus" }).toBe(true);
  expect(await focusedRegion(page)).toBe("Sheet");
}

async function seedCollisions(page: Page): Promise<void> {
  await seedProject(page, { project: collisionsProject() });
  await waitForSheet(page);
}

export const STATES: readonly AppState[] = [
  {
    name: "empty",
    async reach(page) {
      await openEmpty(page);
      await waitForSheet(page);
    },
  },
  { name: "30 cards with collisions", reach: seedCollisions },
  {
    name: "a focused card",
    async reach(page) {
      await seedCollisions(page);
      await focusFirstCard(page);
    },
  },
  {
    name: "init order mode",
    async reach(page) {
      await seedProject(page, { project: recipeProject("GovernedVault", { filled: true }) });
      await waitForSheet(page);
      await runInPalette(page, "Show init order");
      await expect(region(page, "Sheet").getByRole("button", { name: /^Init order/ }).first()).toBeVisible();
    },
  },
  {
    name: "filtered catalog",
    async reach(page) {
      await seedCollisions(page);
      await focusRegion(page, "Left pane");
      const search = region(page, "Left pane").getByRole("textbox", { name: "Search" });
      await tabTo(page, search);
      await page.keyboard.type("erc20");
      await expect(region(page, "Left pane").getByRole("treeitem", { name: /^ERC20\b/ }).first()).toBeVisible();
    },
  },
  {
    name: "palette",
    scope: openDialog,
    async reach(page) {
      await seedCollisions(page);
      await openPalette(page);
      await page.keyboard.type("place");
      await expect(page.getByRole("option").first()).toBeVisible();
      expect(await isFocused(paletteInput(page))).toBe(true);
    },
  },
  {
    name: "export",
    async reach(page) {
      await seedCollisions(page);
      await focusRegion(page, "Console");
      await tabTo(page, region(page, "Console").getByRole("button", { name: "Export", exact: true }));
      await page.keyboard.press("Enter");
      await expect(page.getByRole("menu", { name: "Export" })).toBeVisible();
      await expect(page.getByRole("menuitem").first()).toBeVisible();
    },
  },
];

async function seedErc20(page: Page): Promise<void> {
  await seedProject(page, { project: recipeProject("ERC20", { filled: true }) });
  await waitForSheet(page);
}

/** Beyond the brief's list: dialogs most sessions meet, checked the same way. */
export const DIALOG_STATES: readonly AppState[] = [
  {
    name: "Keyboard shortcuts dialog",
    scope: openDialog,
    async reach(page) {
      await seedErc20(page);
      await focusFirstCard(page);
      await page.keyboard.press("?");
      await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
    },
  },
  {
    name: "Settings dialog",
    scope: openDialog,
    async reach(page) {
      await seedErc20(page);
      await runInPalette(page, "Open Settings");
      await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
    },
  },
  {
    name: "Browse all recipes dialog",
    scope: openDialog,
    async reach(page) {
      await openEmpty(page);
      await waitForSheet(page);
      await focusRegion(page, "Sheet");
      await tabTo(page, region(page, "Sheet").getByRole("button", { name: "Browse all recipes" }));
      await page.keyboard.press("Enter");
      await expect(page.getByRole("dialog", { name: /recipes/i })).toBeVisible();
    },
  },
  {
    name: "Choose per selector dialog",
    scope: openDialog,
    async reach(page) {
      await seedCollisions(page);
      await focusRegion(page, "Sheet");
      await tabTo(page, region(page, "Sheet").getByRole("button", { name: "Choose per selector…" }).first());
      await page.keyboard.press("Enter");
      await expect(page.getByRole("dialog", { name: /per selector/i })).toBeVisible();
    },
  },
];
