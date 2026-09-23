import { afterEach, describe, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { listPaletteRows, openDialog, REGION_LABELS, runCommand, settings, type RegionId } from "@/contracts";
import { bufferedServices, renderWithStudio } from "../../test/harness";
import { resetAnnouncer } from "./announcer";
import { currentRegion } from "./regions";
import { RegionFrame } from "./testing/RegionFrame";

afterEach(() => {
  resetAnnouncer();
});

/** Presses a key and returns the region that has focus afterwards. */
async function press(keys: string): Promise<RegionId | null> {
  await userEvent.keyboard(keys);
  return currentRegion();
}

async function order(keys: string, count: number): Promise<(RegionId | null)[]> {
  const out: (RegionId | null)[] = [];
  for (let i = 0; i < count; i++) out.push(await press(keys));
  return out;
}

describe("regions", () => {
  test("each region is a labelled landmark that takes focus without joining the Tab order", async () => {
    await renderWithStudio(<RegionFrame />);
    for (const name of ["Title bar", "Left pane", "Sheet", "Inspector", "Console"]) {
      const region = page.getByRole("region", { name, exact: true });
      await expect.element(region).toBeInTheDocument();
      expect(region.element().getAttribute("tabindex")).toBe("-1");
    }
  });

  test("F6 cycles title bar, left pane, sheet, inspector and console, and wraps", async () => {
    await renderWithStudio(<RegionFrame />);
    expect(await order("{F6}", 6)).toEqual(["titlebar", "left", "sheet", "inspector", "console", "titlebar"]);
  });

  test("⇧F6 goes the other way", async () => {
    await renderWithStudio(<RegionFrame />);
    expect(await order("{Shift>}{F6}{/Shift}", 6)).toEqual(["console", "inspector", "sheet", "left", "titlebar", "console"]);
  });

  test("toasts are a stop while any show", async () => {
    await renderWithStudio(<RegionFrame toasts={["Link copied"]} />);
    expect(await order("{F6}", 7)).toEqual(["titlebar", "left", "sheet", "inspector", "console", "toasts", "titlebar"]);
    expect(await press("{Shift>}{F6}{/Shift}")).toBe("toasts");
    await expect.element(page.getByRole("region", { name: "Notifications" })).toHaveFocus();
  });

  test("a hidden region is skipped", async () => {
    await renderWithStudio(<RegionFrame hidden={["left", "inspector"]} />);
    expect(await order("{F6}", 4)).toEqual(["titlebar", "sheet", "console", "titlebar"]);
  });

  test("Ctrl+F6 and Ctrl+⇧F6 cycle on Windows and Linux", async () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32");
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
    Object.defineProperty(navigator, "userAgentData", { configurable: true, value: { platform: "Windows" } });
    try {
      await renderWithStudio(<RegionFrame />);
      expect(await order("{Control>}{F6}{/Control}", 2)).toEqual(["titlebar", "left"]);
      expect(await press("{Control>}{Shift>}{F6}{/Shift}{/Control}")).toBe("titlebar");
    } finally {
      delete (navigator as { userAgentData?: unknown }).userAgentData;
      vi.restoreAllMocks();
    }
  });

  test("Ctrl+F6 does nothing on macOS, where it's the system's", async () => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
    Object.defineProperty(navigator, "userAgentData", { configurable: true, value: { platform: "macOS" } });
    try {
      await renderWithStudio(<RegionFrame />);
      expect(await press("{Control>}{F6}{/Control}")).toBeNull();
    } finally {
      delete (navigator as { userAgentData?: unknown }).userAgentData;
      vi.restoreAllMocks();
    }
  });

  test("F6 is taken in the capture phase: listeners on window never see it", async () => {
    await renderWithStudio(<RegionFrame toasts={["Link copied"]} />);
    // Base UI's toast viewport listens on window for F6 with any modifier; a later capture listener too.
    const bubble = vi.fn();
    const capture = vi.fn();
    const onDocument = vi.fn();
    window.addEventListener("keydown", bubble);
    window.addEventListener("keydown", capture, { capture: true });
    document.addEventListener("keydown", onDocument);
    try {
      expect(await press("{F6}")).toBe("titlebar");
      expect(await press("{Shift>}{F6}{/Shift}")).toBe("toasts");
      const f6 = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.filter(([e]) => (e as KeyboardEvent).key === "F6");
      expect(f6(bubble)).toHaveLength(0);
      expect(f6(capture)).toHaveLength(0);
      expect(f6(onDocument)).toHaveLength(0);
      // Other keys pass untouched.
      await userEvent.keyboard("a");
      expect(bubble.mock.calls.some(([e]) => (e as KeyboardEvent).key === "a")).toBe(true);
    } finally {
      window.removeEventListener("keydown", bubble);
      window.removeEventListener("keydown", capture, { capture: true });
      document.removeEventListener("keydown", onDocument);
    }
  });

  test("coming back to a region focuses what last had focus in it", async () => {
    await renderWithStudio(<RegionFrame />);
    await page.getByRole("button", { name: "Inspector control" }).click();
    expect(await press("{F6}")).toBe("console");
    expect(await press("{Shift>}{F6}{/Shift}")).toBe("inspector");
    await expect.element(page.getByRole("button", { name: "Inspector control" })).toHaveFocus();
  });

  test("a remapped shortcut moves the cycle off F6", async () => {
    await renderWithStudio(<RegionFrame />, { settings: { keymap: { "region.next": ["Alt+n"] } } });
    expect(await press("{F6}")).toBeNull();
    expect(await press("{Alt>}n{/Alt}")).toBe("titlebar");
  });

  test("a region shortcut remapped to a single key is inert while typing and when single keys are off", async () => {
    await renderWithStudio(<RegionFrame />, { settings: { keymap: { "region.next": ["n"] } } });
    const field = document.createElement("input");
    page.getByRole("region", { name: "Console" }).element().append(field);
    field.focus();
    await userEvent.keyboard("n");
    expect(document.activeElement).toBe(field);
    expect(field.value).toBe("n");

    const tree = document.createElement("div");
    tree.dataset.keyctx = "tree";
    tree.tabIndex = 0;
    page.getByRole("region", { name: "Inspector" }).element().append(tree);
    tree.focus();
    await userEvent.keyboard("n");
    expect(document.activeElement).toBe(tree);

    (document.activeElement as HTMLElement).blur();
    expect(await press("n")).toBe("titlebar");
    settings.set({ singleKeys: false });
    expect(await press("n")).toBe("titlebar");
  });

  test("a remapped Go to shortcut works", async () => {
    await renderWithStudio(<RegionFrame />, { settings: { keymap: { "region.focus#inspector": ["Alt+i"] } } });
    await userEvent.keyboard("{Alt>}i{/Alt}");
    await expect.element(page.getByRole("region", { name: "Inspector" })).toHaveFocus();
  });

  test("with a dialog open, F6 stays put and says why", async () => {
    await renderWithStudio(<RegionFrame />);
    openDialog("keyboard-shortcuts");
    expect(await press("{F6}")).toBeNull();
    expect(bufferedServices().log.at(-1)?.text).toBe("A dialog is open. Close it to move between regions.");
  });
});

describe("Go to commands", () => {
  test("each region has a palette row, Go to inspector among them", () => {
    const rows = listPaletteRows().filter((r) => r.ref.id === "region.focus");
    expect(rows.map((r) => r.title)).toEqual([
      "Go to title bar", "Go to left pane", "Go to sheet", "Go to inspector", "Go to console",
    ]);
    expect(rows.find((r) => r.title === "Go to inspector")?.binding).toBe("region.focus#inspector");
  });

  test("Go to inspector focuses the inspector", async () => {
    await renderWithStudio(<RegionFrame />);
    expect(await runCommand({ id: "region.focus", args: { region: "inspector" } }, "palette")).toEqual({ ok: true });
    await expect.element(page.getByRole("region", { name: REGION_LABELS.inspector })).toHaveFocus();
  });

  test("Go to notifications is disabled with its reason while none show", async () => {
    await renderWithStudio(<RegionFrame />);
    const result = await runCommand({ id: "region.focus", args: { region: "toasts" } }, "palette");
    expect(result).toEqual({ ok: false, reason: "No notifications are showing." });
    expect(bufferedServices().announce.at(-1)?.[0]).toBe("No notifications are showing.");
  });

  test("a region that isn't showing says so", async () => {
    await renderWithStudio(<RegionFrame hidden={["inspector"]} />);
    await runCommand({ id: "region.focus", args: { region: "inspector" } }, "palette");
    expect(bufferedServices().log.at(-1)?.text).toBe("The inspector isn't showing.");
  });
});
