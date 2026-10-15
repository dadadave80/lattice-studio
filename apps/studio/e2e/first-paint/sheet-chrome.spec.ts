/**
 * The sheet's chrome against the panes over it (#8): GovernedVault opened from a share link at every audited width,
 * with the sheet alone, then each drawer or switcher pane. At each:
 * - no float over the sheet (a React Flow `Panel` or `[data-sheet-float]`) sits under an open drawer;
 * - no two floats overlap;
 * - the page never scrolls sideways;
 * - after first paint every card lies inside the sheet and clear of its floats (the opening view is fitted).
 * Under 768 px it also checks the title bar never shows the name as a letter or two, and that the pinned
 * DiamondCut plan keeps to about a third of the Inspector pane.
 */
import type { Locator, Page } from "@playwright/test";
import { expect, test } from "../_support/fixtures.ts";
import { recipeProject, shareLink } from "../_support/projects.ts";
import { expectTier, tierAt, viewportAt, type ViewportWidth } from "../_support/viewports.ts";

const WIDTHS = [1440, 1100, 900, 768, 375, 320] as const satisfies readonly ViewportWidth[];

type Box = { x: number; y: number; width: number; height: number; label: string };

const LINK = shareLink(recipeProject("GovernedVault").recipe);

function overlaps(a: Box, b: Box): boolean {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0.5 && h > 0.5;
}

/** Boxes of what shows for `selector`, labelled by `data-chrome` or class. */
async function boxes(page: Page, selector: string): Promise<Box[]> {
  return page.evaluate((sel) => {
    const out: Box[] = [];
    for (const el of document.querySelectorAll<HTMLElement>(sel)) {
      if (!el.checkVisibility()) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const label = el.dataset["chrome"] ?? el.dataset["region"] ?? el.dataset["id"] ?? el.className.toString().slice(0, 40);
      out.push({ x: r.left, y: r.top, width: r.width, height: r.height, label });
    }
    return out;
  }, selector) as Promise<Box[]>;
}

/** The floats over the sheet, outermost only (a float inside another counts once). */
async function floats(page: Page): Promise<Box[]> {
  return page.evaluate(() => {
    const all = [...document.querySelectorAll<HTMLElement>('[data-region="sheet"] .react-flow__panel, [data-sheet-float]')];
    const outer = all.filter((el) => !all.some((other) => other !== el && other.contains(el)));
    const out: Box[] = [];
    for (const el of outer) {
      if (!el.checkVisibility()) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const inner = el.querySelector<HTMLElement>("[data-chrome]");
      const label = el.dataset["chrome"] ?? inner?.dataset["chrome"] ?? el.className.toString().slice(0, 40);
      out.push({ x: r.left, y: r.top, width: r.width, height: r.height, label });
    }
    return out;
  }) as Promise<Box[]>;
}

/** Waits until the view stops moving (the first fit, or a glide). */
async function settled(page: Page): Promise<void> {
  const transform = () => page.locator(".react-flow__viewport").first().evaluate((el) => (el as HTMLElement).style.transform);
  let last = "";
  await expect
    .poll(async () => {
      const now = await transform();
      const same = now === last && now !== "";
      last = now;
      return same;
    }, { intervals: [250] })
    .toBe(true);
}

async function expectChromeClear(page: Page): Promise<void> {
  const shown = await floats(page);
  expect(shown.length).toBeGreaterThan(0);
  const drawers = await boxes(page, '[data-drawers] [data-region="left"], [data-drawers] [data-region="inspector"]');
  const underDrawer = shown.flatMap((f) => drawers.filter((d) => overlaps(f, d)).map((d) => `${f.label} under ${d.label}`));
  expect(underDrawer).toEqual([]);
  const clashes: string[] = [];
  for (let i = 0; i < shown.length; i++) {
    for (let j = i + 1; j < shown.length; j++) {
      if (overlaps(shown[i]!, shown[j]!)) clashes.push(`${shown[i]!.label} over ${shown[j]!.label}`);
    }
  }
  expect(clashes).toEqual([]);
}

async function expectNoSidewaysScroll(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth === innerWidth)).toBe(true);
}

/** Clicks a title bar pane toggle (768-1279 px) or switcher tab (under 768 px). */
async function showPane(page: Page, name: "Catalog" | "Inspector", phone: boolean): Promise<Locator> {
  const bar = page.getByRole("region", { name: "Title bar", exact: true });
  if (phone) await bar.getByRole("tab", { name, exact: true }).click();
  else await bar.getByRole("button", { name, exact: true }).click();
  const region = page.locator(`[data-region="${name === "Catalog" ? "left" : "inspector"}"]`);
  await expect(region).toBeVisible();
  return region;
}

for (const width of WIDTHS) {
  const tier = tierAt(width);
  const phone = tier === "phone";
  const drawers = tier === "mid" || tier === "narrow";
  test.describe(`at ${width} px (${tier})`, () => {
    test.use({ viewport: viewportAt(width) });

    test(`the sheet's chrome clears the panes over it, and the opening view is fitted${width === 375 ? " @smoke" : ""}`, async ({
      page,
    }) => {
      await page.goto(`/${LINK}`);
      await expectTier(page, tier);
      await expect(page.locator(".react-flow__node").first()).toBeVisible();
      if (!phone) await expect(page.locator('[data-chrome="title-block"][data-measured]')).toBeVisible();
      await settled(page);

      // The sheet alone: the floats don't overlap, and the fitted cards lie inside the sheet, clear of them.
      await expectChromeClear(page);
      await expectNoSidewaysScroll(page);
      const [sheet] = await boxes(page, '[data-region="sheet"]');
      expect(sheet).toBeDefined();
      const cards = await boxes(page, ".react-flow__node");
      expect(cards.length).toBeGreaterThan(0);
      const outside = cards.filter(
        (c) => c.x < sheet!.x - 0.5 || c.y < sheet!.y - 0.5 || c.x + c.width > sheet!.x + sheet!.width + 0.5 ||
          c.y + c.height > sheet!.y + sheet!.height + 0.5,
      );
      expect(outside.map((c) => c.label)).toEqual([]);
      const shown = await floats(page);
      const covered = cards.flatMap((c) => shown.filter((f) => overlaps(c, f)).map((f) => `${c.label} under ${f.label}`));
      expect(covered).toEqual([]);

      if (phone) {
        // The name shows a few letters or none at all (the Sheet tab carries it then): never one letter.
        const name = page.getByRole("region", { name: "Title bar", exact: true }).getByRole("button", { name: /GovernedVault/ });
        if (await name.count()) {
          const text = await name.locator("span").first().evaluate((el) => (el as HTMLElement).clientWidth);
          expect(text).toBeGreaterThanOrEqual(32);
        } else {
          await expect(page.getByRole("tab", { name: /^Sheet · GovernedVault/ })).toBeVisible();
        }
      }

      // 1280 px and wider the side panes already show beside the sheet, never over it.
      for (const pane of tier === "wide" ? [] : (["Catalog", "Inspector"] as const)) {
        const region = await showPane(page, pane, phone);
        await expectNoSidewaysScroll(page);
        if (drawers) {
          await expect(page.locator(`[data-layout][data-drawer="${pane === "Catalog" ? "left" : "inspector"}"]`)).toHaveCount(1);
          await expectChromeClear(page);
        }
        if (phone && pane === "Inspector") {
          // The pinned DiamondCut plan keeps to about a third of the pane; the view above keeps the rest.
          const plan = region.locator("[data-inspector-plan]");
          await expect(plan).toBeVisible();
          const [own, all] = await Promise.all([plan.boundingBox(), region.boundingBox()]);
          expect(own!.height).toBeLessThanOrEqual(all!.height / 3 + 1);
        }
      }
    });
  });
}
