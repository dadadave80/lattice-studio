import { beforeEach, describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { command, openDialog, runCommand, session, settings } from "@/contracts";
import { Button, DialogHost } from "@/ui";
import { overridePlatform } from "@/ui/shared/platform";
import { onCleanup, overrideCommands, renderWithStudio } from "../../test/harness";
import { installShortcuts } from "./keys/dispatcher";
import { remapBinding } from "./keys/keymap";

beforeEach(() => {
  onCleanup(overridePlatform("mac"));
  onCleanup(installShortcuts());
  overrideCommands([
    command({
      id: "layout.tidy",
      title: () => "Tidy",
      category: "Sheet",
      keys: ["t"],
      keyContext: ["sheet"],
      console: { verb: "tidy", syntax: "tidy", parse: () => ({ ok: true, value: {} }) },
      enabled: () => ({ ok: true }),
      run: () => undefined,
    }),
  ]);
});

function App() {
  return (
    <>
      <Button onClick={() => void runCommand({ id: "shortcuts.open" }, "menu")}>Keyboard shortcuts</Button>
      <DialogHost />
    </>
  );
}

const dialog = () => page.getByRole("dialog", { name: "Keyboard shortcuts" });
const search = () => page.getByRole("textbox", { name: "Search" });
const opener = () => page.getByRole("button", { name: "Keyboard shortcuts" });

describe("Keyboard shortcuts dialog (IR L186)", () => {
  test("? opens it with focus in Search; rows are grouped with their keys and console syntax", async () => {
    await renderWithStudio(<App />);
    (opener().element() as HTMLElement).focus();
    await userEvent.keyboard("?");
    await expect.element(dialog()).toBeVisible();
    await expect.element(search()).toHaveFocus();
    const sheet = page.getByRole("region", { name: "Sheet" });
    await expect.element(sheet).toBeVisible();
    const tidy = sheet.getByRole("listitem").filter({ hasText: "Tidy" });
    await expect.element(tidy.getByText("T", { exact: true })).toBeVisible();
    await expect.element(tidy.getByText("tidy", { exact: true })).toBeVisible();
    const sessionGroup = page.getByRole("region", { name: "Session" });
    await expect.element(sessionGroup.getByRole("listitem").filter({ hasText: "Undo" })).toMatchTextContent(/⌘Z/);
    await expect.element(sessionGroup.getByRole("listitem").filter({ hasText: "Keyboard shortcuts" })).toMatchTextContent(/\?/);
  });

  test("search filters by title, keys or syntax and says how many show", async () => {
    await renderWithStudio(<App />);
    await opener().click();
    await expect.element(search()).toHaveFocus();
    await userEvent.keyboard("undo");
    await expect.element(page.getByText(/^Showing 1 of \d+$/)).toBeVisible();
    await expect.element(page.getByRole("listitem")).toMatchTextContent(/Undo/);
    await userEvent.clear(search());
    await userEvent.type(search(), "⌘Z");
    await expect.element(page.getByRole("listitem").first()).toMatchTextContent(/Undo/);
    await userEvent.clear(search());
    await userEvent.type(search(), "?");
    // Typing ? in Search types it: no second dialog.
    await expect.element(page.getByRole("listitem").first()).toMatchTextContent(/Keyboard shortcuts/);
    expect(session.get().dialogs).toHaveLength(1);
    await userEvent.clear(search());
    await userEvent.type(search(), "zzz");
    await expect.element(page.getByText("No shortcuts match “zzz”.")).toBeVisible();
    await expect.element(page.getByText("Showing 0 of", { exact: false })).toBeVisible();
  });

  test("Esc closes it and focus goes back to what opened it; so does Close", async () => {
    await renderWithStudio(<App />);
    await opener().click();
    await expect.element(search()).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await expect.element(dialog()).not.toBeInTheDocument();
    await expect.element(opener()).toHaveFocus();
    expect(session.get().dialogs).toEqual([]);
    await userEvent.keyboard("{Enter}");
    await expect.element(search()).toHaveFocus();
    await page.getByRole("button", { name: "Close" }).click();
    await expect.element(dialog()).not.toBeInTheDocument();
    await expect.element(opener()).toHaveFocus();
  });

  test("never over another dialog", async () => {
    await renderWithStudio(<App />);
    openDialog("settings");
    await expect.element(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
    await userEvent.keyboard("?");
    const outcome = await runCommand({ id: "shortcuts.open" }, "menu");
    expect(outcome.ok).toBe(false);
    expect(session.get().dialogs.map((d) => d.id)).toEqual(["settings"]);
  });

  test("shows the keys as remapped, and hides single keys while they're off", async () => {
    await renderWithStudio(<App />);
    remapBinding("layout.tidy", ["y"], { platform: "mac" });
    await opener().click();
    const tidy = page.getByRole("listitem").filter({ hasText: "Tidy" });
    await expect.element(tidy.getByText("Y", { exact: true })).toBeVisible();
    settings.set({ singleKeys: false });
    await expect.element(page.getByText("Single-key shortcuts are off. Settings → Keyboard turns them on.")).toBeVisible();
    await expect.element(tidy).not.toBeInTheDocument();
    await expect.element(page.getByRole("listitem").filter({ hasText: "Undo" })).toBeVisible();
  });

  test("a query passed in seeds the search", async () => {
    await renderWithStudio(<App />);
    openDialog("keyboard-shortcuts", { query: "redo" });
    await expect.element(search()).toHaveValue("redo");
    await expect.element(page.getByRole("listitem")).toMatchTextContent(/Redo/);
  });
});
