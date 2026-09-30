/**
 * Scripted keyboard checks (spec L743-L780, the Q2 brief): Skip to sheet first, F6 and Ctrl+F6 order with and
 * without a toast, a visible 2 px focus outline on every Tab stop, single-key shortcuts inert in text fields and
 * trees, and `document.title` following the project. Keyboard only once the page has loaded.
 */
import type { Page } from "@playwright/test";
import { expect, test } from "../_support/fixtures.ts";
import { REGIONS, focusRegion, focusedRegion, nextRegion, pagePlatform, previousRegion, region } from "../_support/keys.ts";
import { collisionsProject, recipeProject } from "../_support/projects.ts";
import { openEmpty, seedProject } from "../_support/seed.ts";
import { focusRing, sheetStop, tabStops, type SheetStop, type TabStop } from "./support/focus.ts";
import { commandLine, isFocused, pressMod, runConsole, runInPalette, tabTo, waitForSheet } from "./support/keyboard.ts";
import { focusFirstCard } from "./support/states.ts";

test.describe("Skip to sheet (spec L743)", () => {
  test("is the first Tab stop and moves focus to the sheet @smoke", async ({ page, browserName }) => {
    await seedProject(page, { project: recipeProject("ERC20") });
    await waitForSheet(page);
    // Safari leaves links out of Tab unless "Press Tab to highlight each item" is on; ⌥Tab is its key for them.
    await page.keyboard.press(browserName === "webkit" ? "Alt+Tab" : "Tab");
    const skip = page.getByRole("link", { name: "Skip to sheet" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    await page.keyboard.press("Enter");
    await expect.poll(() => focusedRegion(page)).toBe("Sheet");
  });
});

test.describe("F6 regions (spec L743, IR L16)", () => {
  test("F6 visits the regions in order and ⇧F6 goes back", async ({ page }) => {
    await openEmpty(page);
    const forward: (string | null)[] = [];
    for (const _ of REGIONS) forward.push(await nextRegion(page));
    expect(forward).toEqual([...REGIONS]);
    expect(await nextRegion(page)).toBe(REGIONS[0]);
    const back: (string | null)[] = [];
    for (const _ of REGIONS) back.push(await previousRegion(page));
    expect(back).toEqual([...REGIONS].reverse());
  });

  test("Ctrl+F6 and Ctrl+⇧F6 do the same on Windows and Linux", async ({ page }) => {
    await openEmpty(page);
    test.skip((await pagePlatform(page)) === "mac", "Ctrl+F6 is bound on Windows and Linux only (IR Keyboard)");
    const forward: (string | null)[] = [];
    for (const _ of REGIONS) forward.push(await nextRegion(page, { ctrl: true }));
    expect(forward).toEqual([...REGIONS]);
    expect(await previousRegion(page, { ctrl: true })).toBe(REGIONS[REGIONS.length - 2]);
  });

  test("with a toast showing, Notifications joins the cycle after the console", async ({ page }) => {
    await seedProject(page, { project: collisionsProject() });
    await waitForSheet(page);
    // Removing several cards at once shows a toast with Undo (spec L733).
    await focusFirstCard(page);
    await pressMod(page, "a");
    await page.keyboard.press("Delete");
    const notifications = region(page, "Notifications");
    await expect(notifications.getByRole("button", { name: "Undo" })).toBeVisible();
    await focusRegion(page, "Console");
    expect(await nextRegion(page)).toBe("Notifications");
    expect(await nextRegion(page)).toBe("Title bar");
    expect(await previousRegion(page)).toBe("Notifications");
    expect(await previousRegion(page)).toBe("Console");
    const ctrl = (await pagePlatform(page)) !== "mac";
    if (ctrl) {
      expect(await nextRegion(page, { ctrl: true })).toBe("Notifications");
      expect(await nextRegion(page, { ctrl: true })).toBe("Title bar");
    }
  });
});

/** The parts Tab passes through, in order, each run of stops in one part counted once. */
function partsInOrder(stops: readonly SheetStop[]): string[] {
  const parts: string[] = [];
  for (const stop of stops) if (parts[parts.length - 1] !== stop.part) parts.push(stop.part);
  return parts;
}

test.describe("Tab leaves the sheet (spec L751, WCAG 2.1.2)", () => {
  test("from the card grid Tab reaches the tool strip, the notes, the title block and the core, then leaves the Sheet", async ({ page }) => {
    await seedProject(page, { project: collisionsProject() });
    await waitForSheet(page);
    await focusFirstCard(page);
    const stops: SheetStop[] = [await sheetStop(page)];
    // The limit turns a trap into a failure instead of a hang: 30 cards' notes fit well under it.
    for (let presses = 0; presses < 200; presses += 1) {
      await page.keyboard.press("Tab");
      const stop = await sheetStop(page);
      stops.push(stop);
      if (stop.part === "outside") break;
    }
    const trail = stops.map((stop) => `${stop.part}: ${stop.describe}`).join("\n");
    const after = stops[stops.length - 1];
    expect(after?.part, `Tab never left the sheet:\n${trail}`).toBe("outside");
    const parts = partsInOrder(stops.slice(0, -1));
    expect(parts, trail).toEqual(["card", "tool strip", "note", "title block", "core"]);
  });
});

function withoutRing(stops: readonly TabStop[]): string[] {
  return stops.filter((stop) => !focusRing(stop).ok).map((stop) => `${stop.describe} · ${focusRing(stop).why}`);
}

test.describe("focus visible (spec L771, WCAG 2.4.7, 2.4.13)", () => {
  for (const [name, seed] of [
    ["empty", (page: Page) => openEmpty(page)],
    ["30 cards with collisions", (page: Page) => seedProject(page, { project: collisionsProject() })],
  ] as const) {
    for (const forced of [false, true]) {
      test(`every Tab stop shows a 2 px outline · ${name}${forced ? " · forced colors" : ""}`, async ({ page }) => {
        if (forced) await page.emulateMedia({ forcedColors: "active" });
        await seed(page);
        await waitForSheet(page);
        const stops = await tabStops(page);
        expect(stops.length).toBeGreaterThan(20);
        const missing = withoutRing(stops);
        expect(missing, missing.join("\n")).toEqual([]);
      });
    }
  }

  test("every Tab stop inside Settings shows a 2 px outline", async ({ page }) => {
    await seedProject(page, { project: recipeProject("ERC20") });
    await waitForSheet(page);
    await runInPalette(page, "Open Settings");
    const settings = page.getByRole("dialog", { name: "Settings" });
    await expect(settings).toBeVisible();
    const stops = await tabStops(page, { fromHere: true, limit: 120 });
    expect(stops.length).toBeGreaterThan(3);
    const missing = withoutRing(stops);
    expect(missing, missing.join("\n")).toEqual([]);
    await expect(settings, "Tab stays inside the modal").toBeVisible();
  });
});

/**
 * Select-all inside a text field is the browser's own editing key, which follows the machine running the browser
 * (⌘A on a macOS host even when the page reports Windows), so it's Playwright's `ControlOrMeta` here.
 */
const SELECT_ALL_TEXT = "ControlOrMeta+a";

/** The sheet's Hand tool, pressed while it's the active tool. */
function handTool(page: Parameters<typeof openEmpty>[0]) {
  return region(page, "Sheet").getByRole("toolbar", { name: "Sheet tools" }).getByRole("button", { name: "Hand" });
}

test.describe("single-key shortcuts (spec L753, WCAG 2.1.4)", () => {
  test("work on the sheet: H picks the Hand tool, V the Select tool", async ({ page }) => {
    await seedProject(page, { project: collisionsProject() });
    await waitForSheet(page);
    await focusFirstCard(page);
    await page.keyboard.press("h");
    await expect(handTool(page)).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("v");
    await expect(handTool(page)).toHaveAttribute("aria-pressed", "false");
  });

  test("are inert in text fields: they type instead", async ({ page }) => {
    await seedProject(page, { project: collisionsProject() });
    await waitForSheet(page);
    const fields = [
      { name: "catalog Search", field: region(page, "Left pane").getByRole("textbox", { name: "Search" }), region: "Left pane" as const },
      { name: "log filter", field: region(page, "Console").getByRole("searchbox", { name: "Filter the log" }), region: "Console" as const },
      { name: "command line", field: commandLine(page), region: "Console" as const },
    ];
    for (const { name, field, region: home } of fields) {
      await focusRegion(page, home);
      await tabTo(page, field);
      await page.keyboard.type("h?i");
      await expect(field, `${name} takes the keys`).toHaveValue("h?i");
      await expect(handTool(page), `H in the ${name} leaves the Select tool on`).toHaveAttribute("aria-pressed", "false");
      await expect(page.getByRole("dialog"), `? in the ${name} opens nothing`).toHaveCount(0);
      await expect(region(page, "Sheet").getByRole("button", { name: /^Init order ·/ })).toHaveCount(0);
      await page.keyboard.press(SELECT_ALL_TEXT);
      await page.keyboard.press("Backspace");
      await expect(field).toHaveValue("");
    }
  });

  test("are inert in trees: the Catalog and Structure trees keep them", async ({ page }) => {
    await seedProject(page, { project: collisionsProject() });
    await waitForSheet(page);
    const left = region(page, "Left pane");
    await focusRegion(page, "Left pane");
    await tabTo(page, left.getByRole("tree", { name: "Catalog" }).getByRole("treeitem").first());
    await page.keyboard.press("h");
    await page.keyboard.press("?");
    await expect(handTool(page)).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await focusedRegion(page)).toBe("Left pane");

    await focusRegion(page, "Left pane");
    // The tabs are one Tab stop (APG tabs): Tab reaches the selected one, → moves to Structure.
    await tabTo(page, left.getByRole("tab", { name: "Catalog" }));
    await page.keyboard.press("ArrowRight");
    await expect(left.getByRole("tab", { name: "Structure" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(left.getByRole("tab", { name: "Structure" })).toHaveAttribute("aria-selected", "true");
    await tabTo(page, left.getByRole("tree").getByRole("treeitem").first());
    await page.keyboard.press("h");
    await page.keyboard.press("?");
    await expect(handTool(page)).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await focusedRegion(page)).toBe("Left pane");
  });
});

test.describe("document.title (spec L780, WCAG 2.4.2)", () => {
  test("names the project and its problems, and follows edits and renames", async ({ page }) => {
    await openEmpty(page);
    await waitForSheet(page);
    await expect(page).toHaveTitle(/^Untitled · .+ · Lattice Studio$/);
    const before = await page.title();

    await runConsole(page, "place erc20");
    await expect(region(page, "Sheet").getByRole("group", { name: /^ERC20, / })).toBeVisible();
    await expect.poll(() => page.title()).not.toBe(before);
    await expect(page).toHaveTitle(/^Untitled · .+ · Lattice Studio$/);

    const titleBar = region(page, "Title bar");
    await focusRegion(page, "Title bar");
    await tabTo(page, titleBar.getByRole("button", { name: "Untitled" }));
    await page.keyboard.press("Enter");
    const field = titleBar.getByRole("textbox");
    await expect(field).toBeFocused();
    await page.keyboard.press(SELECT_ALL_TEXT);
    await page.keyboard.type("Vault draft");
    await page.keyboard.press("Enter");
    await expect(page).toHaveTitle(/^Vault draft · .+ · Lattice Studio$/);
    expect(await isFocused(titleBar.getByRole("button", { name: "Vault draft" }))).toBe(true);
  });
});
