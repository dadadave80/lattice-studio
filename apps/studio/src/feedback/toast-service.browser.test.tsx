import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { command, toast } from "@/contracts";
import { shellToasts } from "@/shell";
import { ToastRegion } from "@/ui";
import { bufferedServices, fakeClock, overrideCommands, renderWithStudio, type FakeClock } from "../../test/harness";

let clock: FakeClock;

function Toasts() {
  return <ToastRegion manager={shellToasts.manager} />;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  clock = fakeClock({ at: "2026-09-23T12:00:00Z", timers: vi });
});

afterEach(() => {
  shellToasts.clear();
  vi.useRealTimers();
});

describe("the toast() service (contracts §5.2, spec L731-L735)", () => {
  test("adds to the shell's one toast manager and logs it as a console line, whether or not it shows", async () => {
    await renderWithStudio(<Toasts />);
    toast({ text: "Link copied" });
    await expect.element(page.getByText("Link copied")).toBeVisible();
    expect(bufferedServices().log.at(-1)).toMatchObject({ tag: "Note", text: "Link copied" });
  });

  test("an error toast logs an Error line and stays until closed", async () => {
    await renderWithStudio(<Toasts />);
    toast({ text: "Couldn't save the project", kind: "error" });
    await expect.element(page.getByText("Couldn't save the project")).toBeVisible();
    expect(bufferedServices().log.at(-1)).toMatchObject({ tag: "Error", text: "Couldn't save the project" });
    clock.advance(60_000);
    await expect.element(page.getByText("Couldn't save the project")).toBeVisible();
  });

  // `ToastInput.action.label` (the CCR of 270a392) now wins over the command's own title (FX14).
  test("an action's label wins over the command's own title, and running it runs that command", async () => {
    const run = vi.fn();
    overrideCommands([
      command({ id: "history.undo", title: () => "Restore", category: "Session", enabled: () => ({ ok: true }), run }),
    ]);
    await renderWithStudio(<Toasts />);
    toast({ text: "Removed 2 facets", action: { id: "history.undo", label: "Undo" } });
    const button = page.getByRole("button", { name: "Undo" });
    await expect.element(button).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Restore" })).not.toBeInTheDocument();
    await button.click();
    expect(run).toHaveBeenCalledTimes(1);
  });

  test("through toast(): an info toast leaves at 6 s, an action toast at 10 s, and hover pauses either", async () => {
    await renderWithStudio(<Toasts />);
    toast({ text: "Link copied" });
    const info = page.getByText("Link copied");
    await expect.element(info).toBeVisible();
    clock.advance(5_900);
    await expect.element(info).toBeVisible();
    clock.advance(200);
    await expect.element(info).not.toBeInTheDocument();

    overrideCommands([
      command({ id: "history.undo", title: () => "Undo", category: "Session", enabled: () => ({ ok: true }), run: () => undefined }),
    ]);
    toast({ text: "Removed 2 facets", action: { id: "history.undo" } });
    const action = page.getByText("Removed 2 facets");
    await expect.element(action).toBeVisible();
    clock.advance(9_000);
    await expect.element(action).toBeVisible();
    await action.hover();
    clock.advance(5_000); // past the 10 s mark, but paused
    await expect.element(action).toBeVisible();
    await userEvent.hover(document.body);
    clock.advance(1_000);
    await expect.element(action).not.toBeInTheDocument();
  });

  test("a toast dropped without showing still gets its own console line, plus a dim note naming why", async () => {
    await renderWithStudio(<Toasts />);
    toast({ text: "Couldn't reach the RPC", kind: "error" });
    toast({ text: "Link copied" });
    toast({ text: "File saved" });
    // Both info toasts were logged even though only the newest waits.
    const notes = bufferedServices().log.filter((l) => l.text === "Link copied" || l.text === "File saved");
    expect(notes).toHaveLength(2);
    const dropped = bufferedServices().log.at(-1);
    expect(dropped).toMatchObject({ tag: "Note", dim: true });
    expect(dropped?.text).toContain("Link copied");
    expect(dropped?.text).toContain("replaced");
  });
});
