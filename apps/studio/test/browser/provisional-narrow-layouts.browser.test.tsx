/**
 * PA L79: "Narrow layouts at 1024 and 768 px, the pane switcher below 768 px, and the title bar carrying the
 * status chip, Deploy… and the overflow menu" has no board. Built from the design system's shell chrome and
 * Shell.browser.test.tsx / TitleBar.browser.test.tsx's real widths (dark only; layout doesn't change by theme).
 *
 * `layout-tier.ts`'s tiers: wide (≥1280), mid (1024-1279, one drawer at a time), narrow (768-1023, Deploy… and
 * the overflow menu join the bar), phone (<768, the pane switcher and no Undo/Redo in the bar). The switcher
 * only exists below 768 px, so the "768 px" board point and the switcher are two different shots here.
 */
import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { page } from "vitest/browser";
import { Shell } from "@/shell";
import { renderWithStudio } from "../harness";

beforeAll(async () => {
  await Promise.all(
    ['400 13px "JetBrains Mono"', '600 13px "JetBrains Mono"', '400 14px Inter', '600 14px Inter', '600 12px Inter'].map(
      (font) => document.fonts.load(font),
    ),
  );
});

afterEach(async () => {
  await page.viewport(1440, 900);
});

const bar = () => page.getByRole("region", { name: "Title bar", exact: true });

function tierOf(width: number): string {
  if (width >= 1280) return "wide";
  if (width >= 1024) return "mid";
  if (width >= 768) return "narrow";
  return "phone";
}

async function renderAt(width: number) {
  await page.viewport(width, 900);
  await renderWithStudio(<Shell />, { settings: { reduceMotion: "on" } });
  await expect.poll(() => document.querySelector("[data-layout]")?.getAttribute("data-layout")).toBe(tierOf(width));
}

describe("provisional: narrow layouts (dark)", () => {
  test("1024 px: the mid tier, one side pane at a time as a drawer", async () => {
    await renderAt(1024);
    await expect.element(bar().getByRole("group", { name: "Panes" })).toBeVisible();
    const startBlock = page.getByRole("region", { name: "Start a diamond" });
    await expect.element(startBlock).toBeVisible();
    // The empty sheet's Start block centers on the sheet's measured height (React Flow's fitView), which can
    // still move a frame or two after the shell's first layout pass; wait until it holds still before shooting.
    const start = () => startBlock.element().getBoundingClientRect().top;
    await expect
      .poll(() => {
        const at = start();
        return new Promise<boolean>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve(start() === at)))),
        );
      })
      .toBe(true);
    await document.fonts.ready;
    await expect.element(page.elementLocator(document.body)).toMatchScreenshot("provisional-narrow-layouts-1024-dark");
  });

  test("768 px: the narrow tier, the title bar carries the status chip, Deploy… and the overflow menu", async () => {
    await renderAt(768);
    await expect.element(bar().getByRole("button", { name: /^Deploy…/ })).toBeVisible();
    await expect.element(bar().getByRole("button", { name: "More" })).toBeVisible();
    await expect.element(bar().getByRole("button", { name: /^Not deployed/ })).toBeVisible();
    await document.fonts.ready;
    await expect.element(page.elementLocator(bar().element() as HTMLElement)).toMatchScreenshot("provisional-narrow-layouts-title-bar-768-dark");
  });

  test("under 768 px: the pane switcher, one pane at a time", async () => {
    await renderAt(600);
    await expect.element(bar().getByRole("tablist", { name: "Panes" })).toBeVisible();
    await expect.element(page.getByRole("region", { name: "Start a diamond" })).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Browse all recipes" })).toBeVisible();
    await expect.element(page.getByRole("button", { name: /^GovernedVault / })).toBeVisible();
    await expect.element(page.getByRole("button", { name: /^SafeDiamondCut / })).toBeVisible();
    const start = () => page.getByRole("button", { name: "Browse all recipes" }).element().getBoundingClientRect().top;
    // The empty sheet's start block centers on the sheet's measured height, which can still move a frame or
    // two after the shell's first layout pass; wait until its position holds still before shooting.
    await expect.poll(() => {
      const a = start();
      return new Promise<boolean>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve(start() === a)))),
      );
    }).toBe(true);
    await document.fonts.ready;
    await expect.element(page.elementLocator(document.body)).toMatchScreenshot("provisional-narrow-layouts-pane-switcher-600-dark");
  });
});
