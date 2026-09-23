import { useRef, useState } from "react";
import { describe, expect, test } from "vitest";
import { page, userEvent } from "vitest/browser";
import { onCleanup, renderWithStudio } from "../../../test/harness";
import { Button } from "../buttons/Button";
import { Dialog, type DialogProps } from "./Dialog";

type HarnessProps = Partial<Omit<DialogProps, "open" | "onOpenChange" | "initialFocus">> & { focusSecond?: boolean };

function Harness({ focusSecond = false, title = "Save a copy", ...rest }: HarnessProps) {
  const [open, setOpen] = useState(false);
  const second = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Open dialog</Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={title}
        description="Choose a file name."
        {...(focusSecond ? { initialFocus: second } : {})}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary">Save</Button>
          </>
        }
        {...rest}
      >
        <label>
          Folder <input aria-label="Folder" />
        </label>
        <label>
          File name <input ref={second} aria-label="File name" />
        </label>
      </Dialog>
    </>
  );
}

async function openWithKeyboard() {
  await userEvent.tab();
  await expect.element(page.getByRole("button", { name: "Open dialog" })).toHaveFocus();
  await userEvent.keyboard("{Enter}");
  await expect.element(page.getByRole("dialog", { name: "Save a copy" })).toBeVisible();
}

describe("Dialog", () => {
  test("is labelled by its title and described, and focuses the first field by default", async () => {
    await renderWithStudio(<Harness />);
    await openWithKeyboard();
    const dialog = page.getByRole("dialog", { name: "Save a copy" });
    await expect.element(dialog).toHaveAccessibleDescription("Choose a file name.");
    expect(dialog.element().getAttribute("data-keyctx")).toBe("dialog");
    await expect.element(page.getByRole("textbox", { name: "Folder" })).toHaveFocus();
  });

  test("honors initialFocus", async () => {
    await renderWithStudio(<Harness focusSecond />);
    await openWithKeyboard();
    await expect.element(page.getByRole("textbox", { name: "File name" })).toHaveFocus();
  });

  test("traps Tab and Shift+Tab inside", async () => {
    await renderWithStudio(<Harness />);
    await openWithKeyboard();
    const order = ["Folder", "File name", "Cancel", "Save"];
    const focusedName = () => {
      const el = document.activeElement as HTMLElement | null;
      return el?.getAttribute("aria-label") ?? el?.textContent ?? "";
    };
    const seen: string[] = [focusedName()];
    for (let i = 0; i < 4; i += 1) {
      await userEvent.tab();
      seen.push(focusedName());
    }
    expect(seen).toEqual([...order, "Folder"]);
    await userEvent.tab({ shift: true });
    expect(focusedName()).toBe("Save");
  });

  test("Esc closes and focus returns to the opener", async () => {
    await renderWithStudio(<Harness />);
    await openWithKeyboard();
    await userEvent.keyboard("{Escape}");
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
    await expect.element(page.getByRole("button", { name: "Open dialog" })).toHaveFocus();
  });

  test("focus returns to the opener after a pointer open and a Cancel click", async () => {
    await renderWithStudio(<Harness />);
    await page.getByRole("button", { name: "Open dialog" }).click();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
    await expect.element(page.getByRole("button", { name: "Open dialog" })).toHaveFocus();
  });

  test("a scrim click doesn't close a dialog that would lose something", async () => {
    await renderWithStudio(<Harness />);
    await openWithKeyboard();
    await page.elementLocator(document.body).click({ position: { x: 8, y: 8 }, force: true });
    await expect.element(page.getByRole("dialog", { name: "Save a copy" })).toBeVisible();
  });

  test("a scrim click closes a lossless dialog", async () => {
    await renderWithStudio(<Harness lossless title="Save a copy" />);
    await openWithKeyboard();
    await page.elementLocator(document.body).click({ position: { x: 8, y: 8 }, force: true });
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
  });

  test("top=false is rendered but inert and hidden", async () => {
    await renderWithStudio(
      <Dialog open onOpenChange={() => {}} title="Settings" top={false}>
        <button type="button">Appearance</button>
      </Dialog>,
    );
    const popup = document.querySelector<HTMLElement>('[data-keyctx="dialog"]');
    expect(popup).not.toBeNull();
    expect(popup?.closest("[inert]")).not.toBeNull();
    expect(popup?.getAttribute("aria-hidden")).toBe("true");
    const button = popup?.querySelector("button");
    button?.focus();
    expect(document.activeElement).not.toBe(button);
    await userEvent.keyboard("{Escape}");
    expect(document.querySelector('[data-keyctx="dialog"]')).not.toBeNull();
  });

  test("is full screen under 768 px wide", async () => {
    await page.viewport(700, 800);
    onCleanup(() => page.viewport(1440, 900));
    await renderWithStudio(<Harness size="wide" />);
    await openWithKeyboard();
    const rect = page.getByRole("dialog").element().getBoundingClientRect();
    expect(rect.left).toBe(0);
    expect(rect.top).toBe(0);
    expect(rect.width).toBe(700);
    expect(rect.height).toBeGreaterThanOrEqual(800);
  });

  test("is 640 px wide when wide on a desktop", async () => {
    await renderWithStudio(<Harness size="wide" />);
    await openWithKeyboard();
    expect(page.getByRole("dialog").element().getBoundingClientRect().width).toBe(640);
  });
});
