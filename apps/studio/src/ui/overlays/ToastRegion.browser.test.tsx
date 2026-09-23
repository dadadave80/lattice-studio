import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { command } from "@/contracts";
import { fakeClock, overrideCommands, renderWithStudio } from "../../../test/harness";
import { Button } from "../buttons/Button";
import { createToasts, toastTimeout, type Toasts } from "./toasts";
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

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    toasts = createToasts();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function render() {
    const clock = fakeClock({ at: "2026-09-23T12:00:00Z", timers: vi });
    await renderWithStudio(
      <>
        <Button onClick={() => toasts.add({ text: "Link copied" })}>Copy link</Button>
        <ToastRegion manager={toasts.manager} />
      </>,
    );
    return clock;
  }

  test("an info toast goes after 6 s, and never takes focus", async () => {
    const clock = await render();
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
    const clock = await render();
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
    const clock = await render();
    toasts.add({ text: "Couldn't write the file", kind: "error" });
    const error = page.getByText("Couldn't write the file");
    await expect.element(error).toBeVisible();
    await expect.element(page.getByRole("img", { name: "Error" })).toBeVisible();
    clock.advance(60_000);
    await expect.element(error).toBeVisible();
    await page.getByRole("button", { name: "Close" }).click();
    await expect.element(error).not.toBeInTheDocument();
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
    const clock = await render();
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
    const clock = await render();
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
