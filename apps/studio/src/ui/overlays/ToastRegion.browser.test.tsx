import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from "vitest";
import { page, userEvent } from "vitest/browser";
import { command } from "@/contracts";
import type { RenderResult } from "vitest-browser-react";
import { fakeClock, overrideCommands, renderWithStudio, type FakeClock } from "../../../test/harness";
import { Button } from "../buttons/Button";
import { createToasts, toastTimeout, WAITING_LIMIT, type ToastsOptions, type Toasts } from "./toasts";
import { ToastRegion } from "./ToastRegion";

describe("toastTimeout", () => {
  test("6 s, 10 s with an action, and errors stay", () => {
    expect(toastTimeout({ text: "Link copied" })).toBe(6_000);
    expect(toastTimeout({ text: "Removed 2 facets", action: { id: "history.undo" } })).toBe(10_000);
    expect(toastTimeout({ text: "Couldn't save", kind: "error" })).toBe(0);
    expect(toastTimeout({ text: "Couldn't save", kind: "error", action: { id: "history.undo" } })).toBe(0);
  });
});

describe("ToastRegion", () => {
  let toasts: Toasts;
  let clock: FakeClock;
  let region: RenderResult;
  let onDrop: Mock<NonNullable<ToastsOptions["onDrop"]>>;
  /** What was dropped, as "text: reason". */
  const drops = () => onDrop.mock.calls.map(([toast, reason]) => `${toast.text}: ${reason}`);

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    clock = fakeClock({ at: "2026-09-23T12:00:00Z", timers: vi });
    onDrop = vi.fn();
    toasts = createToasts({ onDrop });
  });

  const undoCommand = () => {
    const undo = vi.fn();
    overrideCommands([
      command({ id: "history.undo", title: () => "Undo", category: "Session", enabled: () => ({ ok: true }), run: undo }),
    ]);
    return undo;
  };

  afterEach(() => {
    vi.useRealTimers();
  });

  async function render() {
    region = await renderWithStudio(
      <>
        <Button onClick={() => toasts.add({ text: "Link copied" })}>Copy link</Button>
        <ToastRegion manager={toasts.manager} />
      </>,
    );
  }

  test("an info toast goes after 6 s, and never takes focus", async () => {
    await render();
    await userEvent.tab();
    await userEvent.keyboard("{Enter}");
    await expect.element(page.getByText("Link copied")).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Copy link" })).toHaveFocus();
    clock.advance(5_900);
    await expect.element(page.getByText("Link copied")).toBeVisible();
    clock.advance(200);
    await expect.element(page.getByText("Link copied")).not.toBeInTheDocument();
  });

  test("a toast with an action stays 10 s; its button runs the command from the toast", async () => {
    const undo = vi.fn();
    overrideCommands([
      command({ id: "history.undo", title: () => "Undo", category: "Session", enabled: () => ({ ok: true }), run: undo }),
    ]);
    await render();
    toasts.add({ text: "Removed 2 facets", action: { id: "history.undo" } });
    await expect.element(page.getByText("Removed 2 facets")).toBeVisible();
    clock.advance(9_000);
    await expect.element(page.getByText("Removed 2 facets")).toBeVisible();
    await page.getByRole("button", { name: "Undo" }).click();
    expect(undo).toHaveBeenCalledTimes(1);
    expect(undo.mock.calls[0]?.[0]).toMatchObject({ source: "toast" });
    await expect.element(page.getByText("Removed 2 facets")).not.toBeInTheDocument();
  });

  test("an error says so and stays until closed", async () => {
    await render();
    toasts.add({ text: "Couldn't write the file", kind: "error" });
    const error = page.getByText("Couldn't write the file");
    await expect.element(error).toBeVisible();
    await expect.element(page.getByRole("img", { name: "Error" })).toBeVisible();
    clock.advance(60_000);
    await expect.element(error).toBeVisible();
    await page.getByRole("button", { name: "Close" }).click();
    await expect.element(error).not.toBeInTheDocument();
  });

  test("the viewport is the toasts F6 region, named by the region", async () => {
    await render();
    toasts.add({ text: "Link copied" });
    await expect.element(page.getByText("Link copied")).toBeVisible();
    const viewport = document.querySelector<HTMLElement>('[data-region="toasts"]');
    expect(viewport).not.toBeNull();
    expect(viewport?.contains(page.getByText("Link copied").element())).toBe(true);
    await expect.element(page.getByRole("region", { name: "Notifications" })).toBeInTheDocument();
    expect(viewport?.tabIndex).toBe(-1);
  });

  test("while an error shows, only the newest info toast waits; it shows once the error is closed", async () => {
    await render();
    toasts.add({ text: "Couldn't write the file", kind: "error" });
    const error = page.getByText("Couldn't write the file");
    await expect.element(error).toBeVisible();
    toasts.add({ text: "Link copied" });
    toasts.add({ text: "File saved" });
    clock.advance(3_000);
    await expect.element(error).toBeVisible();
    expect(document.body.textContent).not.toContain("Link copied");
    expect(document.body.textContent).not.toContain("File saved");
    await page.getByRole("button", { name: "Close" }).click();
    await expect.element(error).not.toBeInTheDocument();
    // Only the newest shows, not a burst of everything that waited, and it times out from when it shows.
    const saved = page.getByText("File saved");
    await expect.element(saved).toBeVisible();
    expect(document.body.textContent).not.toContain("Link copied");
    clock.advance(5_900);
    await expect.element(saved).toBeVisible();
    clock.advance(200);
    await expect.element(saved).not.toBeInTheDocument();
    expect(drops()).toEqual(["Link copied: replaced"]);
  });

  test("a waiting toast whose own timeout ran out never shows", async () => {
    await render();
    toasts.add({ text: "Couldn't write the file", kind: "error" });
    toasts.add({ text: "File saved" });
    clock.advance(6_000);
    await page.getByRole("button", { name: "Close" }).click();
    await expect.element(page.getByText("Couldn't write the file")).not.toBeInTheDocument();
    clock.advance(100);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.textContent).not.toContain("File saved");
    expect(drops()).toEqual(["File saved: expired"]);
  });

  test("a toast with an action added while an error shows never shows, so its action can't act later", async () => {
    const undo = undoCommand();
    await render();
    toasts.add({ text: "Couldn't write the file", kind: "error" });
    toasts.add({ text: "Link copied" });
    toasts.add({ text: "Removed 2 facets", action: { id: "history.undo" } });
    clock.advance(1_000);
    await page.getByRole("button", { name: "Close" }).click();
    await expect.element(page.getByText("Link copied")).toBeVisible();
    expect(document.body.textContent).not.toContain("Removed 2 facets");
    expect(document.querySelector('[role="dialog"] button')?.textContent).not.toBe("Undo");
    expect(undo).not.toHaveBeenCalled();
    expect(drops()).toEqual(["Removed 2 facets: held"]);
  });

  test("a toast with an action shown before an error doesn't come back when the error closes", async () => {
    const undo = undoCommand();
    await render();
    toasts.add({ text: "Removed 2 facets", action: { id: "history.undo" } });
    await expect.element(page.getByText("Removed 2 facets")).toBeVisible();
    toasts.add({ text: "Couldn't write the file", kind: "error" });
    const error = page.getByText("Couldn't write the file");
    await expect.element(error).toBeVisible();
    // Hovering pauses Base UI's timers, so a toast it only hid would still be waiting to come back.
    await error.hover();
    clock.advance(20_000);
    await page.getByRole("button", { name: "Close" }).click();
    await expect.element(error).not.toBeInTheDocument();
    clock.advance(100);
    expect(document.body.textContent).not.toContain("Removed 2 facets");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(page.getByRole("button", { name: "Undo" }).elements()).toHaveLength(0);
    expect(undo).not.toHaveBeenCalled();
  });

  test("an info toast replaced by another doesn't come back when that one closes", async () => {
    await render();
    toasts.add({ text: "Link copied" });
    await expect.element(page.getByText("Link copied")).toBeVisible();
    toasts.add({ text: "File saved" });
    const saved = page.getByText("File saved");
    await expect.element(saved).toBeVisible();
    await saved.hover();
    clock.advance(7_000);
    await page.getByRole("button", { name: "Close" }).click();
    await expect.element(saved).not.toBeInTheDocument();
    clock.advance(100);
    expect(document.body.textContent).not.toContain("Link copied");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  test("a toast with an action added before a region mounts shows once it does, for what's left of its 10 s", async () => {
    toasts.add({ text: "Removed 2 facets", action: { id: "history.undo" } });
    clock.advance(4_000);
    undoCommand();
    await render();
    // Keep the pointer off the toast: hovering pauses its timer.
    await page.getByRole("button", { name: "Copy link" }).hover();
    const removed = page.getByText("Removed 2 facets");
    await expect.element(removed).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Undo" })).toBeVisible();
    clock.advance(5_900);
    await expect.element(removed).toBeVisible();
    clock.advance(200);
    await expect.element(removed).not.toBeInTheDocument();
  });

  test("before a region mounts: an expired toast is dropped, and one with an action gives way to an error", async () => {
    toasts.add({ text: "Link copied" });
    clock.advance(6_000);
    await render();
    await region.unmount();
    toasts.add({ text: "Removed 2 facets", action: { id: "history.undo" } });
    toasts.add({ text: "Couldn't open the project", kind: "error" });
    undoCommand();
    await render();
    await expect.element(page.getByText("Couldn't open the project")).toBeVisible();
    await page.getByRole("button", { name: "Close" }).click();
    await expect.element(page.getByText("Couldn't open the project")).not.toBeInTheDocument();
    clock.advance(100);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(drops()).toEqual(["Link copied: expired", "Removed 2 facets: held"]);
  });

  test("in StrictMode a region that mounts, unmounts and mounts shows each toast once, and loses none", async () => {
    toasts.add({ text: "Couldn't open the project", kind: "error" });
    const dialogs = () => [...document.querySelectorAll('[role="dialog"]')].map((el) => el.querySelector("p")?.textContent);
    region = await renderWithStudio(
      <StrictMode>
        <ToastRegion manager={toasts.manager} />
      </StrictMode>,
    );
    await expect.element(page.getByText("Couldn't open the project")).toBeVisible();
    expect(dialogs()).toEqual(["Couldn't open the project"]);
    toasts.add({ text: "Link copied" });
    await page.getByRole("button", { name: "Close" }).click();
    await expect.element(page.getByText("Link copied")).toBeVisible();
    await expect.poll(dialogs).toEqual(["Link copied"]);
    await region.unmount();
    toasts.add({ text: "File saved" });
    region = await renderWithStudio(
      <StrictMode>
        <ToastRegion manager={toasts.manager} />
      </StrictMode>,
    );
    await expect.element(page.getByText("File saved")).toBeVisible();
    await expect.poll(dialogs).toEqual(["File saved"]);
    expect(drops()).toEqual([]);
  });

  test("the queue is capped: past the limit the oldest waiting error is dropped", async () => {
    await render();
    for (let i = 1; i <= WAITING_LIMIT + 2; i += 1) toasts.add({ text: `Error ${i}`, kind: "error" });
    await expect.element(page.getByText("Error 1", { exact: true })).toBeVisible();
    const shown: string[] = [];
    for (let i = 0; i <= WAITING_LIMIT; i += 1) {
      const dialog = page.getByRole("dialog");
      await expect.element(dialog).toBeVisible();
      shown.push(dialog.element().querySelector("p")?.textContent ?? "");
      await dialog.getByRole("button", { name: "Close" }).click();
      await expect.poll(() => document.body.textContent?.includes(shown.at(-1) ?? "")).toBe(false);
    }
    expect(shown).toEqual(["Error 1", "Error 3", "Error 4", "Error 5", "Error 6", "Error 7"]);
    expect(drops()).toEqual(["Error 2: cap"]);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  test("dismiss() closes the error showing and lets what waited show; dismiss(id) drops a waiting toast", async () => {
    await render();
    toasts.add({ text: "Couldn't write the file", kind: "error" });
    const second = toasts.add({ text: "Couldn't reach the RPC", kind: "error" });
    toasts.add({ text: "Link copied" });
    await expect.element(page.getByText("Couldn't write the file")).toBeVisible();
    toasts.dismiss(second);
    toasts.dismiss();
    await expect.element(page.getByText("Couldn't write the file")).not.toBeInTheDocument();
    await expect.element(page.getByText("Link copied")).toBeVisible();
    expect(document.body.textContent).not.toContain("Couldn't reach the RPC");
    expect(drops()).toEqual(["Couldn't reach the RPC: dismissed"]);
  });

  test("clear() closes the toast showing, drops what waits and releases the hold", async () => {
    await render();
    toasts.add({ text: "Couldn't write the file", kind: "error" });
    toasts.add({ text: "Couldn't reach the RPC", kind: "error" });
    toasts.add({ text: "Link copied" });
    await expect.element(page.getByText("Couldn't write the file")).toBeVisible();
    toasts.clear();
    await expect.element(page.getByText("Couldn't write the file")).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain("Couldn't reach the RPC");
    expect(document.body.textContent).not.toContain("Link copied");
    expect(drops()).toEqual(["Couldn't reach the RPC: cleared", "Link copied: cleared"]);
    toasts.add({ text: "File saved" });
    await expect.element(page.getByText("File saved")).toBeVisible();
  });

  test("an error added before the region mounts shows once it does, and closing it releases the hold", async () => {
    toasts.add({ text: "Couldn't open the project", kind: "error" });
    await render();
    const error = page.getByText("Couldn't open the project");
    await expect.element(error).toBeVisible();
    toasts.add({ text: "Link copied" });
    await page.getByRole("button", { name: "Close" }).click();
    await expect.element(error).not.toBeInTheDocument();
    await expect.element(page.getByText("Link copied")).toBeVisible();
  });

  test("with no region mounted, dismiss() still closes the held error and dismiss(id) drops a waiting one", async () => {
    await render();
    toasts.add({ text: "Couldn't write the file", kind: "error" });
    await expect.element(page.getByText("Couldn't write the file")).toBeVisible();
    await region.unmount();
    toasts.dismiss();
    const early = toasts.add({ text: "Couldn't open the project", kind: "error" });
    toasts.dismiss(early);
    region = await renderWithStudio(<ToastRegion manager={toasts.manager} />);
    toasts.add({ text: "Link copied" });
    await expect.element(page.getByText("Link copied")).toBeVisible();
    expect(document.body.textContent).not.toContain("Couldn't write the file");
    expect(document.body.textContent).not.toContain("Couldn't open the project");
  });

  test("an error showing when the region unmounts shows again when a region mounts", async () => {
    await render();
    toasts.add({ text: "Couldn't write the file", kind: "error" });
    await expect.element(page.getByText("Couldn't write the file")).toBeVisible();
    await region.unmount();
    expect(document.body.textContent).not.toContain("Couldn't write the file");
    toasts.add({ text: "Link copied" });
    region = await renderWithStudio(<ToastRegion manager={toasts.manager} />);
    const error = page.getByText("Couldn't write the file");
    await expect.element(error).toBeVisible();
    expect(document.body.textContent).not.toContain("Link copied");
    await page.getByRole("button", { name: "Close" }).click();
    await expect.element(error).not.toBeInTheDocument();
    await expect.element(page.getByText("Link copied")).toBeVisible();
  });

  test("a second error waits for the first", async () => {
    await render();
    toasts.add({ text: "Couldn't write the file", kind: "error" });
    toasts.add({ text: "Couldn't reach the RPC", kind: "error" });
    toasts.add({ text: "Link copied" });
    await expect.element(page.getByText("Couldn't write the file")).toBeVisible();
    await page.getByRole("button", { name: "Close" }).click();
    await expect.element(page.getByText("Couldn't write the file")).not.toBeInTheDocument();
    const second = page.getByRole("dialog", { name: "Couldn't reach the RPC" });
    await expect.element(second).toBeVisible();
    expect(document.body.textContent).not.toContain("Link copied");
    await second.getByRole("button", { name: "Close" }).click();
    await expect.element(page.getByText("Link copied")).toBeVisible();
  });

  test("one at a time: a new toast replaces the one showing", async () => {
    await render();
    toasts.add({ text: "Link copied" });
    await expect.element(page.getByText("Link copied")).toBeVisible();
    toasts.add({ text: "File saved" });
    await expect.element(page.getByText("File saved")).toBeVisible();
    await expect.element(page.getByText("Link copied")).not.toBeInTheDocument();
    const shown = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].filter((el) => el.checkVisibility());
    expect(shown).toHaveLength(1);
  });

  test("pauses while hovered", async () => {
    await render();
    toasts.add({ text: "Link copied" });
    const text = page.getByText("Link copied");
    await expect.element(text).toBeVisible();
    await text.hover();
    clock.advance(10_000);
    await expect.element(text).toBeVisible();
    await page.getByRole("button", { name: "Copy link" }).hover();
    clock.advance(7_000);
    await expect.element(text).not.toBeInTheDocument();
  });

  test("pauses while focused", async () => {
    await render();
    toasts.add({ text: "Link copied" });
    await expect.element(page.getByText("Link copied")).toBeVisible();
    (page.getByRole("button", { name: "Close" }).element() as HTMLElement).focus();
    clock.advance(10_000);
    await expect.element(page.getByText("Link copied")).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Close" })).toHaveFocus();
    (document.activeElement as HTMLElement | null)?.blur();
    clock.advance(7_000);
    await expect.element(page.getByText("Link copied")).not.toBeInTheDocument();
  });
});
