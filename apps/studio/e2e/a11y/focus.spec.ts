/**
 * Focus after dialogs and on the sheet (spec L751-L761, L771; WCAG 2.4.3, 2.4.11): every dialog and menu opened
 * from the keyboard takes focus and gives it back to what opened it when it closes with Esc, and a card that
 * takes keyboard focus is never hidden by what floats over the sheet. Keyboard only once the page has loaded. The
 * dialogs around deploying need Anvil and are in `deploy.spec.ts`.
 */
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../_support/fixtures.ts";
import { focusRegion, focusedRegion, region } from "../_support/keys.ts";
import { collisionsProject, recipeProject } from "../_support/projects.ts";
import { openEmpty, seedProject } from "../_support/seed.ts";
import { boxes, overlap, sheetFloats } from "./support/focus.ts";
import { roundTrip } from "./support/dialogs.ts";
import { withoutKnownGaps } from "./support/known-gaps.ts";
import { openPalette, pressMod, runInPalette, tabTo, waitForSheet } from "./support/keyboard.ts";
import { focusFirstCard } from "./support/states.ts";

type DialogCase = {
  name: string;
  /** Seeds, loads and puts focus where the dialog opens from. */
  from(page: Page): Promise<void>;
  /** Opens it from there, keyboard only. */
  open(page: Page): Promise<void>;
  /** The dialog or menu, once open. */
  popup(page: Page): Locator;
};

async function titleBarButton(page: Page, name: string | RegExp): Promise<void> {
  await focusRegion(page, "Title bar");
  await tabTo(page, region(page, "Title bar").getByRole("button", { name, exact: typeof name === "string" }));
}

async function collisions(page: Page): Promise<void> {
  await seedProject(page, { project: collisionsProject() });
  await waitForSheet(page);
}

async function erc20(page: Page): Promise<void> {
  await seedProject(page, { project: recipeProject("ERC20", { filled: true }) });
  await waitForSheet(page);
}

const dialog = (name: string | RegExp) => (page: Page) => page.getByRole("dialog", { name });

const CASES: readonly DialogCase[] = [
  {
    name: "the palette, from a title bar button",
    async from(page) {
      await erc20(page);
      await titleBarButton(page, "Share");
    },
    open: (page) => openPalette(page).then(() => undefined),
    popup: dialog(/.+/),
  },
  {
    name: "the palette, from a focused card",
    async from(page) {
      await collisions(page);
      await focusFirstCard(page);
    },
    open: (page) => openPalette(page).then(() => undefined),
    popup: dialog(/.+/),
  },
  {
    name: "Keyboard shortcuts (?), from a focused card",
    async from(page) {
      await collisions(page);
      await focusFirstCard(page);
    },
    open: (page) => page.keyboard.press("?"),
    popup: dialog("Keyboard shortcuts"),
  },
  {
    name: "Settings, through the palette",
    async from(page) {
      await erc20(page);
      await titleBarButton(page, "Share");
    },
    open: (page) => runInPalette(page, "Open Settings"),
    popup: dialog("Settings"),
  },
  {
    name: "About, through the palette",
    async from(page) {
      await erc20(page);
      await titleBarButton(page, "Share");
    },
    open: (page) => runInPalette(page, "Open About"),
    popup: dialog(/About/),
  },
  {
    name: "Projects, through the palette",
    async from(page) {
      await erc20(page);
      await titleBarButton(page, "Share");
    },
    open: (page) => runInPalette(page, "Projects"),
    popup: dialog("Projects"),
  },
  {
    name: "Save a copy, through the palette",
    async from(page) {
      await erc20(page);
      await titleBarButton(page, "Share");
    },
    open: (page) => runInPalette(page, "Save a copy…"),
    popup: dialog(/Save a copy/),
  },
  {
    name: "Choose an upgrade mechanism, through the palette",
    async from(page) {
      await erc20(page);
      await titleBarButton(page, "Share");
    },
    open: (page) => runInPalette(page, "Choose an upgrade mechanism…"),
    popup: dialog(/upgrade mechanism/i),
  },
  {
    // The test browser blocks the clipboard, so Share shows the link selected under the button (copy-text.ts).
    name: "Share's copy fallback, from its title bar button",
    from: async (page) => {
      await erc20(page);
      await titleBarButton(page, "Share");
    },
    open: (page) => page.keyboard.press("Enter"),
    popup: (page) => page.getByRole("group", { name: /to copy/ }),
  },
  {
    name: "the app menu, from its title bar button",
    from: async (page) => {
      await erc20(page);
      await titleBarButton(page, "Lattice Studio");
    },
    open: (page) => page.keyboard.press("Enter"),
    popup: (page) => page.getByRole("menu"),
  },
  {
    name: "the Export menu, from the console",
    from: async (page) => {
      await erc20(page);
      await focusRegion(page, "Console");
      await tabTo(page, region(page, "Console").getByRole("button", { name: "Export", exact: true }));
    },
    open: (page) => page.keyboard.press("Enter"),
    popup: (page) => page.getByRole("menu", { name: "Export" }),
  },
  {
    name: "Browse all recipes, from the empty sheet",
    async from(page) {
      await openEmpty(page);
      await waitForSheet(page);
      await focusRegion(page, "Sheet");
      await tabTo(page, region(page, "Sheet").getByRole("button", { name: "Browse all recipes" }));
    },
    open: (page) => page.keyboard.press("Enter"),
    popup: dialog(/recipes/i),
  },
  {
    name: "Choose per selector, from a collision note",
    async from(page) {
      await collisions(page);
      await focusRegion(page, "Sheet");
      await tabTo(page, region(page, "Sheet").getByRole("button", { name: "Choose per selector…" }).first());
    },
    open: (page) => page.keyboard.press("Enter"),
    popup: dialog(/per selector/i),
  },
];

test.describe("focus returns after every dialog (spec L751-L761, WCAG 2.4.3)", () => {
  for (const c of CASES) {
    test(c.name, async ({ page }) => {
      await c.from(page);
      await roundTrip(page, () => c.open(page), c.popup(page));
    });
  }
});

/** The element's box once a pan has settled: two reads 100 ms apart that agree (at most 3 s). */
async function settledBox(locator: Locator): Promise<{ x: number; y: number; width: number; height: number } | null> {
  let last = await locator.boundingBox();
  for (let tries = 0; tries < 30; tries += 1) {
    await locator.page().waitForTimeout(100);
    const next = await locator.boundingBox();
    if (next && last && Math.abs(next.x - last.x) < 0.5 && Math.abs(next.y - last.y) < 0.5) return next;
    last = next;
  }
  return last;
}

test.describe("a focused card is never hidden by floating UI (spec L771, WCAG 2.4.11)", () => {
  test("Home, End and ⌘/Ctrl+arrows bring each card clear of the tool strip, zoom, title block and toasts", async ({ page }) => {
    await collisions(page);
    await runInPalette(page, "Zoom to 200%");
    await expect(region(page, "Sheet").getByRole("button", { name: "Zoom 200%" })).toBeVisible();
    await focusFirstCard(page);
    const moves = ["End", "Home", "End", "ArrowLeft", "ArrowUp", "ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"];
    const seen = new Set<string>();
    const problems: string[] = [];
    for (const key of moves) {
      if (key.startsWith("Arrow")) await pressMod(page, key);
      else await page.keyboard.press(key);
      expect(await focusedRegion(page), `${key} keeps focus on the sheet`).toBe("Sheet");
      const card = page.locator(":focus");
      const name = await card.evaluate((el) => (el.getAttribute("aria-label") ?? el.textContent ?? "").slice(0, 40));
      seen.add(name);
      const box = await settledBox(card);
      const sheetBox = await region(page, "Sheet").boundingBox();
      if (!box || !sheetBox) {
        problems.push(`${key} → ${name}: no box`);
        continue;
      }
      const floats = await boxes(sheetFloats(page));
      const covered = floats.reduce((sum, float) => sum + overlap(box, float), 0);
      const onSheet = overlap(box, sheetBox);
      // A card that fits the sheet is kept clear of everything floating (spec L771); one taller or wider than the
      // sheet can't be, and must at least not be entirely hidden (2.4.11).
      const fits = box.height <= sheetBox.height - 48 && box.width <= sheetBox.width - 48;
      if (fits && covered > 0) {
        const under = floats.filter((float) => overlap(box, float) > 0).map((float) => JSON.stringify(float));
        problems.push(`${key} → ${name}: ${covered} px² under floating UI at ${under.join(", ")} (card ${JSON.stringify(box)})`);
      }
      if (!fits && onSheet - covered <= 0) problems.push(`${key} → ${name}: entirely hidden`);
    }
    const unknown = withoutKnownGaps(problems, test.info());
    expect(unknown, unknown.join("\n")).toEqual([]);
    expect(seen.size, "the keys moved focus between cards").toBeGreaterThan(1);
  });
});
