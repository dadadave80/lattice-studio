// The palette's chunk loads when the app is idle (spec L822). Its own file, so no other test has loaded it.
import { expect, test } from "vitest";
import { page } from "vitest/browser";
import { onCleanup, renderWithStudio } from "../../test/harness";
import { CommandPalette } from "./CommandPalette";
import { loadedPalette, resetPaletteState } from "./palette-state";

test("the host renders nothing and loads nothing until the app is idle, then loads the chunk", async () => {
  onCleanup(resetPaletteState);
  let idle: (() => void) | null = null;
  const preload = (task: () => void) => {
    idle = task;
    return () => {
      idle = null;
    };
  };
  const screen = await renderWithStudio(<CommandPalette preload={preload} />);
  expect(screen.container.childElementCount).toBe(0);
  expect(loadedPalette()).toBeNull();
  expect(idle).not.toBeNull();
  (idle as unknown as () => void)();
  await expect.poll(() => loadedPalette()).not.toBeNull();
  // Loaded, but still closed: nothing shows.
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
});
