import { describe, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { bufferedServices, onCleanup, renderWithStudio } from "../../../test/harness";
import { Button } from "../buttons/Button";
import { Dialog } from "../overlays/Dialog";
import { overridePlatform } from "../shared/platform";
import { copyText, dismissCopyFallback } from "./copy-text";

const LOWER = "0x5fbdb2315678afecb367f032d93f642f64180aa3";
const CHECKSUMMED = "0x5FbDB2315678afecb367f032d93F642f64180aa3";

function fakeClipboard(fails = false) {
  const writeText = vi.fn(async (text: string) => {
    if (fails) throw new DOMException("Write permission denied.", "NotAllowedError");
    return void text;
  });
  return { writeText };
}

describe("copyText", () => {
  test("puts an address on the clipboard checksummed and echoes it in the toast", async () => {
    const clipboard = fakeClipboard();
    const result = await copyText(LOWER, { clipboard });
    expect(clipboard.writeText).toHaveBeenCalledWith(CHECKSUMMED);
    expect(result).toEqual({ ok: true, text: CHECKSUMMED });
    expect(bufferedServices().toast.at(-1)).toEqual({ text: "Copied 0x5FbD…0aa3" });
  });

  test("copies anything else exactly and names it by its label", async () => {
    const clipboard = fakeClipboard();
    const link = "https://studio.lattice.dev/#r=AbC_def-123";
    await copyText(link, { clipboard, label: "link" });
    expect(clipboard.writeText).toHaveBeenCalledWith(link);
    expect(bufferedServices().toast.at(-1)).toEqual({ text: "Copied link" });
  });

  test("a short value without a label is named by itself", async () => {
    await copyText("0xa9059cbb", { clipboard: fakeClipboard() });
    expect(bufferedServices().toast.at(-1)).toEqual({ text: "Copied 0xa9059cbb" });
  });

  test("uses navigator.clipboard by default", async () => {
    const spy = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    onCleanup(() => spy.mockRestore());
    await copyText(LOWER);
    expect(spy).toHaveBeenCalledWith(CHECKSUMMED);
  });

  test("when the clipboard is blocked, the text is selected with Press ⌘C to copy", async () => {
    onCleanup(overridePlatform("mac"));
    onCleanup(dismissCopyFallback);
    const clipboard = fakeClipboard(true);
    await renderWithStudio(<Button onClick={() => void copyText(LOWER, { clipboard })}>Copy</Button>);
    const opener = page.getByRole("button", { name: "Copy" });
    await opener.click();

    const field = page.getByRole("textbox", { name: "Press ⌘C to copy" });
    await expect.element(field).toBeVisible();
    await expect.element(field).toHaveFocus();
    const area = field.element() as HTMLTextAreaElement;
    expect(area.value).toBe(CHECKSUMMED);
    expect(area.selectionStart).toBe(0);
    expect(area.selectionEnd).toBe(CHECKSUMMED.length);
    // Nothing claimed a copy that didn't happen.
    expect(bufferedServices().toast).toEqual([]);

    // The person copies: the toast confirms and focus goes back to the control.
    area.dispatchEvent(new Event("copy", { bubbles: true }));
    expect(bufferedServices().toast.at(-1)).toEqual({ text: "Copied 0x5FbD…0aa3" });
    await expect.poll(() => document.querySelector("[data-copy-fallback]")).toBeNull();
    await expect.element(opener).toHaveFocus();
  });

  test("the fallback says Ctrl+C on Windows and Linux, and Esc closes it with focus back on the control", async () => {
    onCleanup(overridePlatform("other"));
    onCleanup(dismissCopyFallback);
    await renderWithStudio(<Button onClick={() => void copyText("0xa9059cbb", { clipboard: null })}>Copy selector</Button>);
    const opener = page.getByRole("button", { name: "Copy selector" });
    await opener.click();
    const field = page.getByRole("textbox", { name: "Press Ctrl+C to copy" });
    await expect.element(field).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => document.querySelector("[data-copy-fallback]")).toBeNull();
    await expect.element(opener).toHaveFocus();
    expect(bufferedServices().toast).toEqual([]);
  });

  test("message replaces the toast text, on the clipboard and in the fallback", async () => {
    onCleanup(dismissCopyFallback);
    const link = "https://studio.lattice.dev/#r=AbC";
    await copyText(link, { clipboard: fakeClipboard(), message: "Link copied · 732 characters" });
    expect(bufferedServices().toast.at(-1)).toEqual({ text: "Link copied · 732 characters" });

    await renderWithStudio(
      <Button onClick={() => void copyText(link, { clipboard: null, message: "Link copied · 732 characters" })}>Copy link</Button>,
    );
    await page.getByRole("button", { name: "Copy link" }).click();
    const area = document.querySelector<HTMLTextAreaElement>("[data-copy-fallback] textarea");
    area?.dispatchEvent(new Event("copy", { bubbles: true }));
    expect(bufferedServices().toast.at(-1)).toEqual({ text: "Link copied · 732 characters" });
  });

  test("inside a modal dialog the fallback stays in the dialog and doesn't close it", async () => {
    onCleanup(overridePlatform("mac"));
    onCleanup(dismissCopyFallback);
    const onOpenChange = vi.fn();
    await renderWithStudio(
      <Dialog open onOpenChange={onOpenChange} title="Share" lossless>
        <Button onClick={() => void copyText(LOWER, { clipboard: null })}>Copy address</Button>
      </Dialog>,
    );
    const dialog = page.getByRole("dialog", { name: "Share" });
    await page.getByRole("button", { name: "Copy address" }).click();
    const field = page.getByRole("textbox", { name: "Press ⌘C to copy" });
    await expect.element(field).toHaveFocus();
    expect(dialog.element().contains(field.element())).toBe(true);
    await field.click();
    await new Promise((r) => setTimeout(r, 100));
    expect(onOpenChange).not.toHaveBeenCalled();
    await expect.element(field).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await expect.poll(() => document.querySelector("[data-copy-fallback]")).toBeNull();
    await expect.element(page.getByRole("button", { name: "Copy address" })).toHaveFocus();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  test("returns blocked so callers can tell", async () => {
    onCleanup(dismissCopyFallback);
    const result = await copyText(LOWER, { clipboard: fakeClipboard(true) });
    expect(result).toEqual({ ok: false, text: CHECKSUMMED, reason: "blocked" });
  });
});
