import { useState } from "react";
import { describe, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { bufferedServices, onCleanup, renderWithStudio } from "../../../test/harness";
import { Button } from "../buttons/Button";
import { Dialog } from "../overlays/Dialog";
import { ContextMenu } from "../overlays/ContextMenu";
import { Menu } from "../overlays/Menu";
import { MenuItem } from "../overlays/MenuItem";
import { Submenu } from "../overlays/Submenu";
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

function CopyMenu({ clipboard, nested }: { clipboard: Pick<Clipboard, "writeText">; nested: boolean }) {
  const [open, setOpen] = useState(false);
  const item = <MenuItem label="Share" keepOpen onSelect={() => {
    void copyText("https://studio.lattice.dev/#s=1.link", { clipboard }).then(() => setOpen(false));
  }} />;
  return (
    <Menu label="More" trigger={<Button>More</Button>} open={open} onOpenChange={setOpen}>
      {nested ? <Submenu label="Copy">{item}</Submenu> : item}
    </Menu>
  );
}

function CopyFromPoint({ clipboard }: { clipboard: Pick<Clipboard, "writeText"> }) {
  const [open, setOpen] = useState(false);
  const [invoker, setInvoker] = useState<HTMLButtonElement | null>(null);
  return <>
    <Button ref={setInvoker} onClick={() => setOpen(true)}>Pin</Button>
    <ContextMenu label="Pin actions" open={open} onOpenChange={setOpen} invoker={invoker} items={
      <MenuItem label="Copy selector" keepOpen onSelect={() => {
        void copyText("0xa9059cbb", { clipboard }).then(() => setOpen(false));
      }} />
    }><span data-menu-point="" /></ContextMenu>
  </>;
}

function ClosingCopyDialog({ clipboard }: { clipboard: Pick<Clipboard, "writeText"> }) {
  const [open, setOpen] = useState(false);
  return <>
    <Button onClick={() => setOpen(true)}>Share</Button>
    <Dialog open={open} onOpenChange={setOpen} title="Share" lossless>
      <Button onClick={() => void copyText("link", { clipboard })}>Copy link</Button>
      <Button onClick={() => setOpen(false)}>Cancel</Button>
    </Dialog>
  </>;
}

function HiddenCopyPane({ clipboard }: { clipboard: Pick<Clipboard, "writeText"> }) {
  const [hidden, setHidden] = useState(false);
  return <>
    <Button onClick={() => setHidden(true)}>Sheet</Button>
    <div hidden={hidden}>
      <Button onClick={() => void copyText("plan", { clipboard })}>Copy plan as JSON</Button>
    </div>
  </>;
}

describe("copyText", () => {
  for (const nested of [false, true]) test(`Escape restores the ${nested ? "nested " : ""}menu opener after clipboard rejection and menu detach`, async () => {
    onCleanup(dismissCopyFallback);
    let rejectClipboard: ((reason: Error) => void) | undefined;
    const clipboard = { writeText: vi.fn(() => new Promise<void>((_resolve, reject) => { rejectClipboard = reject; })) };
    await renderWithStudio(<CopyMenu clipboard={clipboard} nested={nested} />);
    const opener = page.getByRole("button", { name: "More", exact: true });
    (opener.element() as HTMLElement).focus();
    await userEvent.keyboard("{Enter}");
    if (nested) {
      await expect.element(page.getByRole("menuitem", { name: "Copy", exact: true })).toHaveFocus();
      await userEvent.keyboard("{ArrowRight}");
    }
    await expect.element(page.getByRole("menuitem", { name: "Share" })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(clipboard.writeText).toHaveBeenCalledOnce();
    rejectClipboard?.(new Error("Clipboard blocked"));
    await expect.element(page.getByRole("textbox", { name: /to copy/ })).toHaveFocus();
    await expect.poll(() => document.querySelector('[role="menu"]')).toBeNull();
    await userEvent.keyboard("{Escape}");
    await expect.element(opener).toHaveFocus();
  });

  test("a positioned context menu restores its persistent invoker after clipboard rejection", async () => {
    onCleanup(dismissCopyFallback);
    let rejectClipboard: ((reason: Error) => void) | undefined;
    const clipboard = { writeText: vi.fn(() => new Promise<void>((_resolve, reject) => { rejectClipboard = reject; })) };
    await renderWithStudio(<CopyFromPoint clipboard={clipboard} />);
    const opener = page.getByRole("button", { name: "Pin", exact: true });
    await opener.click();
    await expect.element(page.getByRole("menuitem", { name: "Copy selector" })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(clipboard.writeText).toHaveBeenCalledOnce();
    rejectClipboard?.(new Error("Clipboard blocked"));
    await expect.element(page.getByRole("textbox", { name: /to copy/ })).toHaveFocus();
    await expect.poll(() => document.querySelector('[role="menu"]')).toBeNull();
    await userEvent.keyboard("{Escape}");
    await expect.element(opener).toHaveFocus();
  });

  test("a clipboard rejection after its dialog closes uses the current live origin", async () => {
    onCleanup(dismissCopyFallback);
    let rejectClipboard: ((reason: Error) => void) | undefined;
    const clipboard = { writeText: vi.fn(() => new Promise<void>((_resolve, reject) => { rejectClipboard = reject; })) };
    await renderWithStudio(<ClosingCopyDialog clipboard={clipboard} />);
    const opener = page.getByRole("button", { name: "Share", exact: true });
    await opener.click();
    await page.getByRole("button", { name: "Copy link" }).click();
    expect(clipboard.writeText).toHaveBeenCalledOnce();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect.element(page.getByRole("dialog", { name: "Share" })).not.toBeInTheDocument();
    await expect.element(opener).toHaveFocus();
    rejectClipboard?.(new Error("Clipboard blocked"));
    await expect.element(page.getByRole("textbox", { name: /to copy/ })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await expect.element(opener).toHaveFocus();
  });

  test("a copy started in the body focus gap restores the later live origin", async () => {
    onCleanup(dismissCopyFallback);
    let rejectClipboard: ((reason: Error) => void) | undefined;
    const clipboard = { writeText: vi.fn(() => new Promise<void>((_resolve, reject) => { rejectClipboard = reject; })) };
    await renderWithStudio(<Button>Return target</Button>);
    expect(document.activeElement).toBe(document.body);
    const pending = copyText("link", { clipboard });
    const opener = page.getByRole("button", { name: "Return target" });
    await opener.click();
    rejectClipboard?.(new Error("Clipboard blocked"));
    await pending;
    await expect.element(page.getByRole("textbox", { name: /to copy/ })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await expect.element(opener).toHaveFocus();
  });

  test("a clipboard rejection after its pane hides restores the live tab", async () => {
    onCleanup(dismissCopyFallback);
    let rejectClipboard: ((reason: Error) => void) | undefined;
    const clipboard = { writeText: vi.fn(() => new Promise<void>((_resolve, reject) => { rejectClipboard = reject; })) };
    await renderWithStudio(<HiddenCopyPane clipboard={clipboard} />);
    await page.getByRole("button", { name: "Copy plan as JSON" }).click();
    expect(clipboard.writeText).toHaveBeenCalledOnce();
    const tab = page.getByRole("button", { name: "Sheet", exact: true });
    await tab.click();
    rejectClipboard?.(new Error("Clipboard blocked"));
    await expect.element(page.getByRole("textbox", { name: /to copy/ })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await expect.element(tab).toHaveFocus();
  });

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
