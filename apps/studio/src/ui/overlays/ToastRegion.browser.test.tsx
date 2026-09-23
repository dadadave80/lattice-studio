import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { command } from "@/contracts";
import type { RenderResult } from "vitest-browser-react";
import { fakeClock, overrideCommands, renderWithStudio, type FakeClock } from "../../../test/harness";
import { Button } from "../buttons/Button";
import { createToasts, toastTimeout, WAITING_LIMIT, type Toasts } from "./toasts";
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

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    clock = fakeClock({ at: "2026-09-23T12:00:00Z", timers: vi });
    toasts = createToasts();
  });

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
  });

  test("a toast with an action never waits, so its action can't act later on something else", async () => {
    const undo = vi.fn();
    overrideCommands([
      command({ id: "history.undo", title: () => "Undo", category: "Session", enabled: () => ({ ok: true }), run: undo }),
    ]);
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
    await expect.element(page.getByText("Link copied")).not.toBeVisible();
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
