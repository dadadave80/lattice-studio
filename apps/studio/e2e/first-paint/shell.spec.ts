/**
 * Static first paint (WP-S11b; spec L821-L826, L815 LCP). Three things must hold:
 *
 * - With no JavaScript at all, the page still shows the title bar and the pane outlines, at the sizes the
 *   real shell uses (Shell.module.css, TitleBar.module.css, panes.ts PANE_SIZES): a 40 px title bar, a 240 px
 *   left pane, a 316 px inspector and a 160 px console (36 px header + 124 px body).
 * - The empty sheet's Start block, its largest paint, is in that static markup too (Q19), where the real one
 *   lands and the same size, so LCP doesn't wait for the app.
 * - Once React mounts and replaces that static markup with the real shell (`[data-region]`, S3), nothing
 *   already on screen moves: cumulative layout shift stays under 0.02.
 */
import { expect, test } from "@playwright/test";

const TITLE_BAR_HEIGHT = 40;
const LEFT_PANE_WIDTH = 240;
const INSPECTOR_WIDTH = 316;
const CONSOLE_HEIGHT = 160;
const CLS_BUDGET = 0.02;

test.describe("the static shell (no JavaScript)", () => {
  test.use({ javaScriptEnabled: false });

  test("shows the title bar and pane outlines at the shell's sizes", async ({ page }) => {
    await page.goto("/");

    const shell = page.locator("[data-static-shell]");
    await expect(shell).toBeVisible();
    await expect(shell).toContainText("Lattice Studio");

    const titlebar = shell.locator(".lxs-titlebar");
    const titleBox = await titlebar.boundingBox();
    expect(titleBox?.height).toBeCloseTo(TITLE_BAR_HEIGHT, 0);

    const left = shell.locator(".lxs-pane--left");
    const leftBox = await left.boundingBox();
    expect(leftBox?.width).toBeCloseTo(LEFT_PANE_WIDTH, 0);

    const inspector = shell.locator(".lxs-pane--inspector");
    const inspectorBox = await inspector.boundingBox();
    expect(inspectorBox?.width).toBeCloseTo(INSPECTOR_WIDTH, 0);

    const consolePane = shell.locator(".lxs-console");
    const consoleBox = await consolePane.boundingBox();
    expect(consoleBox?.height).toBeCloseTo(CONSOLE_HEIGHT, 0);

    // No script ran, so #root still holds the static markup; React never got a chance to replace it.
    await expect(page.locator('[data-region="titlebar"]')).toHaveCount(0);
  });

  test("hides the side panes and the console under 768 px, like the phone tier (spec L369)", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/");

    const shell = page.locator("[data-static-shell]");
    await expect(shell.locator(".lxs-titlebar")).toBeVisible();
    await expect(shell.locator(".lxs-pane--left")).toBeHidden();
    await expect(shell.locator(".lxs-pane--inspector")).toBeHidden();
    await expect(shell.locator(".lxs-console")).toBeHidden();
  });
});

test.describe("the static Start block", () => {
  test("shows with no JavaScript, where the real one lands and at its size", async ({ browser, baseURL, page }) => {
    const still = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 900 } });
    const staticPage = await still.newPage();
    await staticPage.goto(`${baseURL}/`);
    const block = staticPage.locator("[data-static-shell] .lxs-start");
    await expect(block).toBeVisible();
    await expect(block).toContainText("Start a diamond");
    const staticBox = await block.boundingBox();
    await still.close();

    // The real block, before the catalog arrives: every choice waits on it, as the static one shows.
    await page.route("**/catalog/**", () => new Promise(() => {}));
    await page.goto("/");
    const real = page.locator("[data-chrome='start'] section");
    await expect(real).toBeVisible();
    await expect(page.locator("[data-static-shell]")).toHaveCount(0);
    const realBox = await real.boundingBox();
    for (const side of ["x", "y", "width", "height"] as const) expect(staticBox?.[side]).toBeCloseTo(realBox?.[side] ?? -1, 0);
  });
});

test.describe("layout stability while React mounts", () => {
  test(`keeps cumulative layout shift under ${CLS_BUDGET} (spec L821)`, async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __lxCls: number };
      w.__lxCls = 0;
      try {
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            const shift = entry as unknown as { value: number; hadRecentInput: boolean };
            if (!shift.hadRecentInput) w.__lxCls += shift.value;
          }
        }).observe({ type: "layout-shift", buffered: true });
      } catch {
        // The Layout Instability API is Chromium-only; other engines just report 0.
      }
    });

    await page.goto("/");

    // React mounts and replaces the static markup with the real, labelled regions (S3's Shell). The
    // PerformanceObserver above was attached before any page script ran, so it sees that swap even when it
    // happens before this line gets a chance to check (a fast local server can beat `goto`'s load event).
    const titlebar = page.locator('[data-region="titlebar"]');
    await titlebar.waitFor({ state: "attached" });
    await expect(page.locator("[data-static-shell]")).toHaveCount(0);

    // Let any pending font swap (font-display: swap) and layout settle before reading the score.
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);

    // The Layout Instability API only scores elements that were on screen in a previous frame and moved: the
    // static markup was destroyed and the real shell is new, so neither scores, whatever size either one is.
    // This is the assertion that actually proves the real shell landed at S3's sizes (Shell.tsx's PANE_IDS).
    const titleBox = await titlebar.boundingBox();
    expect(titleBox?.height).toBeCloseTo(TITLE_BAR_HEIGHT, 0);
    const leftBox = await page.locator("#shell-left").boundingBox();
    expect(leftBox?.width).toBeCloseTo(LEFT_PANE_WIDTH, 0);
    const inspectorBox = await page.locator("#shell-inspector").boundingBox();
    expect(inspectorBox?.width).toBeCloseTo(INSPECTOR_WIDTH, 0);
    const consoleBox = await page.locator("#shell-console").boundingBox();
    expect(consoleBox?.height).toBeCloseTo(CONSOLE_HEIGHT, 0);

    const cls = await page.evaluate(() => (window as unknown as { __lxCls: number }).__lxCls);
    expect(cls).toBeLessThan(CLS_BUDGET);
  });
});
