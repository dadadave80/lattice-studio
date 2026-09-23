import { beforeEach, describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { command, settings } from "@/contracts";
import { checkRemap, resetBinding, resetKeymap } from "@/commands";
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

  test("toggling single-key shortcuts writes the setting and its copy quotes spec L631", async () => {
    await renderWithStudio(<KeyboardGroup />);
    await expect
      .element(
        page.getByText(
          "Shortcuts match the character a key types, so they follow the person's layout; letter shortcuts fall back to the key's position on non-Latin layouts.",
        ),
      )
      .toBeVisible();
    await page.getByRole("switch", { name: "Single-key shortcuts" }).click();
    expect(settings.get().singleKeys).toBe(false);
  });

  test("Change… stays mounted and focused while it captures, and gets focus back on commit", async () => {
    await renderWithStudio(<KeyboardGroup />);
    const tidyRow = page.getByRole("listitem").filter({ hasText: "Tidy" });
    const change = tidyRow.getByRole("button", { name: "Change…" });
    const changeButton = change.element();
    await change.click();
    const listening = tidyRow.getByRole("button", { name: "Press a key, or Esc to cancel" });
    await expect.element(listening).toBeVisible();
    expect(listening.element()).toBe(changeButton); // the same button, only relabeled: nothing unmounts
    expect(document.activeElement).toBe(changeButton);

    await userEvent.keyboard("y");
    await expect.element(tidyRow.getByText("Y", { exact: true })).toBeVisible();
    expect(settings.get().keymap["layout.tidy"]).toEqual([{ keys: "y", platform: "mac" }]);
    await expect.element(tidyRow.getByRole("button", { name: "Change…" })).toHaveFocus();

    // What `resetBinding` would say, read without disturbing the state the UI is about to reset itself.
    const before = settings.get().keymap;
    const expectedText = resetBinding("layout.tidy");
    settings.set({ keymap: before });

    await tidyRow.getByRole("button", { name: "Reset" }).click();
    await expect.element(tidyRow.getByText("T", { exact: true })).toBeVisible();
    expect(settings.get().keymap["layout.tidy"]).toBeUndefined();
    await expect.element(page.getByText(expectedText, { exact: true })).toBeVisible();
  });

  test("Backspace while capturing clears the binding", async () => {
    await renderWithStudio(<KeyboardGroup />);
    const tidyRow = page.getByRole("listitem").filter({ hasText: "Tidy" });
    await tidyRow.getByRole("button", { name: "Change…" }).click();
    await userEvent.keyboard("{Backspace}");
    await expect.element(tidyRow.getByText("No shortcut")).toBeVisible();
    expect(settings.get().keymap["layout.tidy"]).toEqual([]);
    await expect.element(tidyRow.getByRole("button", { name: "Change…" })).toHaveFocus();
  });

  test("Esc cancels capture without remapping, and focus goes back to Change…", async () => {
    await renderWithStudio(<KeyboardGroup />);
    const tidyRow = page.getByRole("listitem").filter({ hasText: "Tidy" });
    const change = tidyRow.getByRole("button", { name: "Change…" });
    await change.click();
    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByText("Press a key, or Esc to cancel")).not.toBeInTheDocument();
    await expect.element(tidyRow.getByText("T", { exact: true })).toBeVisible();
    await expect.element(tidyRow.getByRole("button", { name: "Change…" })).toHaveFocus();
  });

  test("a key already used elsewhere reports the conflict (no role=alert; it's not an interrupting failure) and moves focus to Use this key anyway", async () => {
    await renderWithStudio(<KeyboardGroup />);
    // What `checkRemap` says for this exact collision (⌘Z is Undo's default); read, not asserted verbatim,
    // so this test tracks the API's own wording (FX13) instead of a copy the API no longer produces.
    const expectedReason = checkRemap("layout.tidy", [{ keys: "Mod+z", platform: "mac" }], { platform: "mac" })?.reason;
    expect(expectedReason).toBeDefined();
    const tidyRow = page.getByRole("listitem").filter({ hasText: "Tidy" });
    await tidyRow.getByRole("button", { name: "Change…" }).click();
    await userEvent.keyboard("{Meta>}z{/Meta}");
    const reasonText = page.getByText(expectedReason!, { exact: true });
    await expect.element(reasonText).toBeVisible();
    expect(reasonText.element().closest('[role="alert"]')).toBeNull();
    const anyway = page.getByRole("button", { name: "Use this key anyway" });
    await expect.element(anyway).toHaveFocus();
    await anyway.click();
    await expect.element(tidyRow.getByText("⌘Z", { exact: true })).toBeVisible();
  });

  test("keyboard-only: Change…, ⌘Z, then Enter on the focused Use this key anyway", async () => {
    await renderWithStudio(<KeyboardGroup />);
    const tidyRow = page.getByRole("listitem").filter({ hasText: "Tidy" });
    (tidyRow.getByRole("button", { name: "Change…" }).element() as HTMLElement).focus();
    await userEvent.keyboard("{Enter}"); // activates Change…, starting capture
    await userEvent.keyboard("{Meta>}z{/Meta}");
    await expect.element(page.getByRole("button", { name: "Use this key anyway" })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await expect.element(tidyRow.getByText("⌘Z", { exact: true })).toBeVisible();
    expect(settings.get().keymap["layout.tidy"]).toBeDefined();
  });

  test("Reset all shortcuts clears every override and shows what it did", async () => {
    settings.set({ keymap: { "layout.tidy": [{ keys: "y", platform: "other" }] } });
    await renderWithStudio(<KeyboardGroup />);

    // What `resetKeymap` would say, read without disturbing the state the UI is about to reset itself.
    const before = settings.get().keymap;
    const expectedText = resetKeymap();
    settings.set({ keymap: before });

    await page.getByRole("button", { name: "Reset all shortcuts" }).click();
    expect(settings.get().keymap).toEqual({});
    await expect.element(page.getByText(expectedText, { exact: true })).toBeVisible();
  });
});
