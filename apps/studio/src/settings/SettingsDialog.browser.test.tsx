import { describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { openDialog, runCommand, session } from "@/contracts";
import { Button, DialogHost } from "@/ui";
import { renderWithStudio } from "../../test/harness";

function App() {
  return (
    <>
      <Button onClick={() => void runCommand({ id: "settings.open" }, "menu")}>Settings</Button>
      <DialogHost />
    </>
  );
}

const dialog = () => page.getByRole("dialog", { name: "Settings" });
const tab = (name: string) => page.getByRole("tab", { name });
const opener = () => page.getByRole("button", { name: "Settings" });

describe("Settings dialog (Flow 16, IR L183)", () => {
  test("settings.open shows it with the first group's tab focused", async () => {
    await renderWithStudio(<App />);
    (opener().element() as HTMLElement).focus();
    await userEvent.keyboard("{Enter}");
    await expect.element(dialog()).toBeVisible();
    await expect.element(tab("Appearance")).toHaveFocus();
    await expect.element(tab("Appearance")).toHaveAttribute("aria-selected", "true");
  });

  test("a group can be opened directly", async () => {
    await renderWithStudio(<App />);
    openDialog("settings", { group: "networks" });
    await expect.element(dialog()).toBeVisible();
    await expect.element(tab("Networks")).toHaveAttribute("aria-selected", "true");
  });

  test("clicking a tab switches the visible panel, and only that one is in the DOM", async () => {
    await renderWithStudio(<App />);
    openDialog("settings");
    await expect.element(tab("Appearance")).toHaveAttribute("aria-selected", "true");
    await tab("Data").click();
    await expect.element(tab("Data")).toHaveAttribute("aria-selected", "true");
    await expect.element(tab("Appearance")).toHaveAttribute("aria-selected", "false");
    const panels = document.querySelectorAll<HTMLElement>('[role="tabpanel"]');
    expect(panels).toHaveLength(1);
  });

  test("Esc closes it and focus goes back to what opened it; so does Close", async () => {
    await renderWithStudio(<App />);
    await opener().click();
    await expect.element(dialog()).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect.element(dialog()).not.toBeInTheDocument();
    await expect.element(opener()).toHaveFocus();
    expect(session.get().dialogs).toEqual([]);
    await opener().click();
    await page.getByRole("button", { name: "Close" }).click();
    await expect.element(dialog()).not.toBeInTheDocument();
    await expect.element(opener()).toHaveFocus();
  });

  test("stacks over another dialog: it stays mounted but inert, then interactive again once the one above closes", async () => {
    await renderWithStudio(<App />);
    openDialog("settings");
    openDialog("clear-data");
    expect(session.get().dialogs.map((d) => d.id)).toEqual(["settings", "clear-data"]);
    // Base UI hides an inert dialog from the accessibility tree, so `getByRole` can't see it; it's still
    // mounted underneath, and Clear data is the one that's interactive (top, IR L170-L187).
    await expect.element(page.getByRole("dialog", { name: "Clear data" })).toBeVisible();
    expect(document.querySelector('[aria-hidden="true"] [role="dialog"]')?.textContent).toContain("Settings");
    // Clear data (S7b) has no Close button; Cancel loses nothing (spec's confirm-only-where-it-can't-be-undone).
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect.element(dialog()).toBeVisible();
    expect(session.get().dialogs.map((d) => d.id)).toEqual(["settings"]);
  });
});
