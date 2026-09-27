import { describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { closeDialog, openDialog, overrideDialog, session, type DialogComponentProps } from "@/contracts";
import { onCleanup, renderWithStudio } from "../../../test/harness";
import { Button } from "../buttons/Button";
import { Dialog } from "./Dialog";
import { DialogHost } from "./DialogHost";

function TestSettings({ entry, top }: DialogComponentProps<"settings">) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) closeDialog(entry.id);
      }}
      title="Settings"
      lossless
      top={top}
      footer={<Button onClick={() => closeDialog("settings")}>Close</Button>}
    >
      <Button>Appearance</Button>
      <Button onClick={() => openDialog("browse-recipes")}>Clear data…</Button>
    </Dialog>
  );
}

// A stand-in for whatever dialog Settings opens over itself. The stacking tests below use `overrideDialog` to
// put these on "settings" and "browse-recipes" regardless of what their real owners (S10, S4d) have registered,
// so they're about DialogHost's own mechanics (inert lower dialog, focus trap, Esc and scrim behavior), not
// about what a real Settings or Clear data dialog looks like (S7b already has a real "clear-data":
// apps/studio/src/projects/dialogs/ClearDataDialogPanel.tsx).
function TestClearData({ entry, top }: DialogComponentProps<"browse-recipes">) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) closeDialog(entry.id);
      }}
      title="Clear data"
      lossless
      top={top}
      footer={<Button onClick={() => closeDialog("browse-recipes")}>Close</Button>}
    >
      <p>Everything this deletes.</p>
    </Dialog>
  );
}

function App() {
  return (
    <>
      <Button onClick={() => openDialog("settings")}>Open settings</Button>
      <DialogHost />
    </>
  );
}

describe("DialogHost", () => {
  test("shows a placeholder for a dialog nobody registered yet", async () => {
    onCleanup(overrideDialog("deploy-review", null)); // Whether or not S8b's dialog has landed.
    await renderWithStudio(<DialogHost />);
    openDialog("deploy-review");
    const dialog = page.getByRole("dialog", { name: "Deploy review" });
    await expect.element(dialog).toBeVisible();
    await expect.element(dialog.getByText("Not built yet · WP-S8b")).toBeVisible();
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
    expect(session.get().dialogs).toEqual([]);
  });

  test("a v2 dialog names the phase it arrives in", async () => {
    await renderWithStudio(<DialogHost />);
    openDialog("open-diamond");
    await expect.element(page.getByRole("dialog", { name: "Open diamond" }).getByText("Arrives in v2.")).toBeVisible();
  });

  test("renders the registered component and returns focus to the opener after closing", async () => {
    onCleanup(overrideDialog("settings", TestSettings)); // S10 registers the real one
    await renderWithStudio(<App />);
    await userEvent.tab();
    await userEvent.keyboard("{Enter}");
    const settings = page.getByRole("dialog", { name: "Settings" });
    await expect.element(settings).toBeVisible();
    await expect.element(settings.getByRole("button", { name: "Appearance" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
    await expect.element(page.getByRole("button", { name: "Open settings" })).toHaveFocus();
  });

  test("stacks: the lower dialog stays mounted but inert; closing the top returns focus into it", async () => {
    onCleanup(overrideDialog("settings", TestSettings));
    onCleanup(overrideDialog("browse-recipes", TestClearData));
    await renderWithStudio(<App />);
    await page.getByRole("button", { name: "Open settings" }).click();
    const clearButton = page.getByRole("button", { name: "Clear data…" });
    await clearButton.click();

    const top = page.getByRole("dialog", { name: "Clear data" });
    await expect.element(top).toBeVisible();
    await expect.element(top.getByRole("button", { name: "Close" })).toHaveFocus();
    // Settings is still in the DOM, inert and hidden from assistive technology.
    const popups = [...document.querySelectorAll<HTMLElement>('[data-keyctx="dialog"]')];
    expect(popups).toHaveLength(2);
    expect(popups[0]?.closest("[inert]")).not.toBeNull();
    expect(page.getByRole("dialog", { name: "Settings" }).query()).toBeNull();

    // Tab stays inside the top dialog.
    await userEvent.tab();
    await userEvent.tab();
    expect(popups[1]?.contains(document.activeElement)).toBe(true);

    // Esc closes only the top one; focus goes back to the control in Settings that opened it.
    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByRole("dialog", { name: "Clear data" })).not.toBeInTheDocument();
    await expect.element(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
    await expect.element(clearButton).toHaveFocus();
    expect(session.get().dialogs.map((d) => d.id)).toEqual(["settings"]);
    // Settings traps Tab again.
    for (let i = 0; i < 4; i += 1) {
      await userEvent.tab();
      expect(popups[0]?.contains(document.activeElement)).toBe(true);
    }
    clearButton.element().focus();

    // Settings is interactive again, and closing it returns focus to the opener.
    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
    await expect.element(page.getByRole("button", { name: "Open settings" })).toHaveFocus();
  });

  test("a scrim click on the stack closes only the top lossless dialog", async () => {
    onCleanup(overrideDialog("settings", TestSettings));
    onCleanup(overrideDialog("browse-recipes", TestClearData));
    await renderWithStudio(<App />);
    await page.getByRole("button", { name: "Open settings" }).click();
    await page.getByRole("button", { name: "Clear data…" }).click();
    await expect.element(page.getByRole("dialog", { name: "Clear data" })).toBeVisible();
    await page.elementLocator(document.body).click({ position: { x: 8, y: 8 }, force: true });
    await expect.element(page.getByRole("dialog", { name: "Clear data" })).not.toBeInTheDocument();
    await expect.element(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
  });

  test("overrideDialog wins over whatever a real owner registered", async () => {
    function RealAbout({ entry, top }: DialogComponentProps<"about">) {
      return (
        <Dialog open onOpenChange={() => {}} title="Real about" lossless top={top}>
          <p>{entry.id}</p>
        </Dialog>
      );
    }
    function TestAbout({ top }: DialogComponentProps<"about">) {
      return (
        <Dialog open onOpenChange={() => {}} title="Test about" lossless top={top}>
          <p>stand-in</p>
        </Dialog>
      );
    }
    onCleanup(overrideDialog("about", RealAbout)); // stands in for the owner's registration, whether or not S10 has landed
    onCleanup(overrideDialog("about", TestAbout));
    await renderWithStudio(<DialogHost />);
    openDialog("about");
    await expect.element(page.getByRole("dialog", { name: "Test about" })).toBeVisible();
    expect(page.getByRole("dialog", { name: "Real about" }).elements()).toHaveLength(0);
  });
});
