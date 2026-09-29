/**
 * Keyboard helpers against the shell: F6 and ⇧F6 cycle the regions (S9), F8 reaches a problem's note (S4c), ⌘K
 * opens the palette (S6) and the console runs a verb (S5e). Specs whose work package hasn't landed skip with its
 * name.
 */
import { showsNotBuilt, skipUnlessBuilt } from "../built.ts";
import { expect, test } from "../fixtures.ts";
import {
  REGIONS, commandLine, focusedRegion, nextProblem, nextRegion, openPalette, pagePlatform, paletteDialog, previousRegion,
  runConsole, runInPalette,
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
    // The analysis that finds the collision runs after the seeded project loads, so F8 (`problem.next`) is
    // disabled (no problems yet) for a moment: retry it inside the poll instead of pressing it once and waiting,
    // or a press that lands before the analysis catches up never gets a second try.
    const settled = async () => {
      await nextProblem(page);
      // Either focus lands on a note, or a placeholder answers (S4c's is announced once F8 runs it).
      return (await focusedRegion(page)) === "Sheet" || (await showsNotBuilt(page, "S4b")) || (await showsNotBuilt(page, "S4c"));
    };
    await expect.poll(settled).toBe(true);
    await skipUnlessBuilt(page, "S4b", "S4c");
    expect(await focusedRegion(page)).toBe("Sheet");
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

  test("runInPalette returns once the palette has closed and the command has run", async ({ page }) => {
    await openEmpty(page);
    await runInPalette(page, "Open Settings");
    expect(await paletteDialog(page).count()).toBe(0);
    await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
  });

  test("runInPalette fails on a disabled command, which keeps the palette open", async ({ page }) => {
    await openEmpty(page);
    // Nothing is placed, so Deploy… is disabled with its reason.
    await expect(runInPalette(page, "Deploy…")).rejects.toThrow(/the palette should close and run "Deploy…"/);
    await expect(paletteDialog(page)).toBeVisible();
  });

  test("the console runs a verb", async ({ page }) => {
    await openEmpty(page);
    await skipUnlessBuilt(page, "S5e");
    await runConsole(page, "help");
    await expect(commandLine(page)).toHaveValue("");
    await expect(page.getByRole("log")).toContainText("help");
  });
});
