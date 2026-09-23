import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
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

  // `ToastInput.action.label` (the CCR of 270a392) isn't rendered by `ui/overlays/toasts.ts` yet (FX14, not
  // landed and outside this WP's scope): the button still shows the command's own title. This test pins
  // today's behavior so it flags the day the label starts winning; see the Follow-ups in the WP-S10 report.
  test("an action's ref is passed through to the toast, and running its button runs that command", async () => {
    const run = vi.fn();
    overrideCommands([
      command({ id: "history.undo", title: () => "Restore", category: "Session", enabled: () => ({ ok: true }), run }),
    ]);
    await renderWithStudio(<Toasts />);
    toast({ text: "Removed 2 facets", action: { id: "history.undo", label: "Undo" } });
    const button = page.getByRole("button", { name: "Restore" });
    await expect.element(button).toBeVisible();
    await button.click();
    expect(run).toHaveBeenCalledTimes(1);
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
