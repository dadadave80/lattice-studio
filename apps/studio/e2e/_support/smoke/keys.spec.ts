/**
 * Keyboard helpers against the shell: F6 and ⇧F6 cycle the regions (S9), F8 reaches a problem's note (S4c), ⌘K
 * opens the palette (S6) and the console runs a verb (S5e). Specs whose work package hasn't landed skip with its
 * name.
 */
import { skipUnlessBuilt } from "../built.ts";
import { expect, test } from "../fixtures.ts";
import {
  REGIONS, commandLine, focusedRegion, nextProblem, nextRegion, openPalette, pagePlatform, previousRegion, runConsole,
} from "../keys.ts";
import { collisionsProject } from "../projects.ts";
import { openEmpty, seedProject } from "../seed.ts";

test.describe("keyboard helpers @smoke", () => {
  test("F6 visits every region in order, ⇧F6 goes back", async ({ page }) => {
    await openEmpty(page);
    const forward: (string | null)[] = [];
    for (const _ of REGIONS) forward.push(await nextRegion(page));
    expect(forward).toEqual([...REGIONS]);
    expect(await nextRegion(page)).toBe(REGIONS[0]);
    expect(await previousRegion(page)).toBe(REGIONS[REGIONS.length - 1]);
    expect(await previousRegion(page)).toBe(REGIONS[REGIONS.length - 2]);
  });

  test("Ctrl+F6 cycles too, on Windows and Linux", async ({ page }) => {
    await openEmpty(page);
    test.skip((await pagePlatform(page)) === "mac", "Ctrl+F6 is bound on Windows and Linux only (IR Keyboard)");
    expect(await nextRegion(page, { ctrl: true })).toBe(REGIONS[0]);
    expect(await nextRegion(page, { ctrl: true })).toBe(REGIONS[1]);
  });

  test("F8 moves focus to a problem's note", async ({ page }) => {
    await seedProject(page, { project: collisionsProject() });
    await nextProblem(page);
    await skipUnlessBuilt(page, "S4b", "S4c");
    await expect.poll(() => focusedRegion(page)).toBe("Sheet");
  });

  test("⌘K opens the palette", async ({ page }) => {
    await openEmpty(page);
    await skipUnlessBuilt(page, "S6");
    const input = await openPalette(page);
    await expect(input).toBeFocused();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(input).toHaveCount(0);
  });

  test("the console runs a verb", async ({ page }) => {
    await openEmpty(page);
    await skipUnlessBuilt(page, "S5e");
    await runConsole(page, "help");
    await expect(commandLine(page)).toHaveValue("");
    await expect(page.getByRole("log")).toContainText("help");
  });
});
