// The palette's chunk loads on the first ⌘K when the app hasn't been idle yet (spec L822). Its own file, so no
// other test has loaded it.
import { expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { installShortcuts } from "@/commands";
import { Button } from "@/ui";
import { overridePlatform } from "@/ui/shared/platform";
import { onCleanup, renderWithStudio } from "../../test/harness";
import { CommandPalette } from "./CommandPalette";
import { loadedPalette, resetPaletteState } from "./palette-state";

test("the first ⌘K loads the chunk and opens the palette; focus still goes back to where it was", async () => {
  onCleanup(resetPaletteState);
  onCleanup(overridePlatform("mac"));
  onCleanup(installShortcuts());
  await renderWithStudio(
    <>
      <Button>Opener</Button>
      <CommandPalette preload={() => () => undefined} />
    </>,
  );
  expect(loadedPalette()).toBeNull();
  const opener = page.getByRole("button", { name: "Opener" });
  (opener.element() as HTMLElement).focus();
  await userEvent.keyboard("{Meta>}k{/Meta}");
  await expect.element(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
  expect(loadedPalette()).not.toBeNull();
  await expect.element(page.getByRole("combobox", { name: "Search commands, facets and recipes" })).toHaveFocus();
  await userEvent.keyboard("{Escape}");
  await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  await expect.element(opener).toHaveFocus();
});
