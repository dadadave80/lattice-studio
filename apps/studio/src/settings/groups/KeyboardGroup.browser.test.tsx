import { beforeEach, describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { command, settings } from "@/contracts";
import { onCleanup, overrideCommands, pristineCommands, renderWithStudio } from "../../../test/harness";
import { overridePlatform } from "@/ui/shared/platform";
import { KeyboardGroup } from "./KeyboardGroup";

beforeEach(() => {
  onCleanup(overridePlatform("mac"));
  pristineCommands();
  overrideCommands([
    command({
      id: "layout.tidy",
      title: () => "Tidy",
      category: "Sheet",
      keys: ["t"],
      enabled: () => ({ ok: true }),
      run: () => undefined,
    }),
    command({
      id: "history.undo",
      title: () => "Undo",
      category: "Session",
      keys: ["Mod+z"],
      enabled: () => ({ ok: true }),
      run: () => undefined,
    }),
  ]);
});

describe("Settings → Keyboard (Flow 16, spec L633)", () => {
  test("lists every remappable shortcut with its current keys, grouped by category", async () => {
    await renderWithStudio(<KeyboardGroup />);
    await expect.element(page.getByRole("region", { name: "Sheet" })).toBeVisible();
    await expect.element(page.getByRole("region", { name: "Session" })).toBeVisible();
    const tidyRow = page.getByRole("listitem").filter({ hasText: "Tidy" });
    await expect.element(tidyRow.getByText("T", { exact: true })).toBeVisible();
    const undoRow = page.getByRole("listitem").filter({ hasText: "Undo" });
    await expect.element(undoRow.getByText("⌘Z", { exact: true })).toBeVisible();
  });

  test("toggling single-key shortcuts writes the setting", async () => {
    await renderWithStudio(<KeyboardGroup />);
    await page.getByRole("switch", { name: "Single-key shortcuts" }).click();
    expect(settings.get().singleKeys).toBe(false);
  });

  test("Change… captures the next key and remaps the binding; Reset puts it back", async () => {
    await renderWithStudio(<KeyboardGroup />);
    const tidyRow = page.getByRole("listitem").filter({ hasText: "Tidy" });
    await tidyRow.getByRole("button", { name: "Change…" }).click();
    await expect.element(page.getByText("Press a key, or Esc to cancel")).toBeVisible();
    await userEvent.keyboard("y");
    await expect.element(tidyRow.getByText("Y", { exact: true })).toBeVisible();
    expect(settings.get().keymap["layout.tidy"]).toEqual([{ keys: "y", platform: "mac" }]);
    await tidyRow.getByRole("button", { name: "Reset" }).click();
    await expect.element(tidyRow.getByText("T", { exact: true })).toBeVisible();
    expect(settings.get().keymap["layout.tidy"]).toBeUndefined();
  });

  test("Esc cancels capture without remapping", async () => {
    await renderWithStudio(<KeyboardGroup />);
    const tidyRow = page.getByRole("listitem").filter({ hasText: "Tidy" });
    await tidyRow.getByRole("button", { name: "Change…" }).click();
    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByText("Press a key, or Esc to cancel")).not.toBeInTheDocument();
    await expect.element(tidyRow.getByText("T", { exact: true })).toBeVisible();
  });

  test("a key already used elsewhere reports the conflict and offers to take it over", async () => {
    await renderWithStudio(<KeyboardGroup />);
    const tidyRow = page.getByRole("listitem").filter({ hasText: "Tidy" });
    await tidyRow.getByRole("button", { name: "Change…" }).click();
    // ⌘Z is Undo's default; capturing it for Tidy is a conflict.
    await userEvent.keyboard("{Meta>}z{/Meta}");
    await expect.element(page.getByText("⌘Z is already used for Undo.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Use this key anyway" }).click();
    await expect.element(tidyRow.getByText("⌘Z", { exact: true })).toBeVisible();
  });

  test("Reset all shortcuts clears every override", async () => {
    settings.set({ keymap: { "layout.tidy": [{ keys: "y", platform: "other" }] } });
    await renderWithStudio(<KeyboardGroup />);
    await page.getByRole("button", { name: "Reset all shortcuts" }).click();
    expect(settings.get().keymap).toEqual({});
  });
});
