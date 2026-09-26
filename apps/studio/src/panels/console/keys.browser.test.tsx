/**
 * The console's keys follow the registry (spec L660-L661, IR L35): `console.clear`'s shortcut, from the command
 * line and from the Log, and `problem.next`'s key in "Resolve N blockers to export · <key>", each as remapped
 * in Settings → Keyboard.
 */
import type { Platform } from "@lattice-studio/core";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { chordOf } from "@/commands/keys/key-spec";
import { installShortcuts } from "@/commands/keys/dispatcher";
import { DEFAULT_SETTINGS, listBindings, log, settings, type SettingsState } from "@/contracts";
import { overridePlatform } from "@/ui/shared/platform";
import { onCleanup, renderWithStudio } from "../../../test/harness";
import { clearsTheLog, COMMAND_LABEL } from "./CommandLine";
import { ConsolePanel } from "./ConsolePanel";
import { resolveToExport } from "./export-enablement";
import { nextProblemKey, type KeyView } from "./export-gates";
import { logEntries } from "./log-store";
import { awaitConsoleBody, collisionProject, erc20Project, resetConsole } from "./test-support";

beforeEach(() => resetConsole());

const input = () => page.getByRole("textbox", { name: COMMAND_LABEL });
const texts = () => logEntries().map((e) => e.text);

async function renderConsole(on: Platform, keymap: SettingsState["keymap"] = {}, project = erc20Project()) {
  onCleanup(overridePlatform(on));
  await renderWithStudio(
    <div style={{ height: "400px", display: "flex" }}>
      <ConsolePanel />
    </div>,
    { project, settings: { keymap } },
  );
  await awaitConsoleBody();
}

/** Logs a line and waits for it to render. */
async function seedLine(text = "Placed ERC20 · 9 selectors") {
  log({ tag: "Note", text });
  await expect.element(page.getByRole("button", { name: new RegExp(text) })).toBeInTheDocument();
  return page.getByRole("button", { name: new RegExp(text) });
}

/** Focuses the command line and presses `keys` there. */
async function pressInCommandLine(keys: string): Promise<void> {
  await userEvent.click(input());
  await userEvent.keyboard(keys);
}

describe("console.clear from the command line follows its binding (spec L660, IR L35)", () => {
  test("default: Ctrl L clears on macOS", async () => {
    await renderConsole("mac");
    await seedLine();
    await pressInCommandLine("{Control>}l{/Control}");
    await vi.waitFor(() => expect(logEntries()).toEqual([]));
  });

  test("default: Ctrl L does nothing on Windows and Linux, where it's the address bar", async () => {
    await renderConsole("other");
    await seedLine();
    await pressInCommandLine("{Control>}l{/Control}");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(texts()).toEqual(["Placed ERC20 · 9 selectors"]);
  });

  test("remapped to Ctrl K: Ctrl L no longer clears, Ctrl K does", async () => {
    await renderConsole("mac", { "console.clear": [{ keys: "Ctrl+k", platform: "mac" }] });
    await seedLine();
    await pressInCommandLine("{Control>}l{/Control}");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(texts()).toEqual(["Placed ERC20 · 9 selectors"]);
    await userEvent.keyboard("{Control>}k{/Control}");
    await vi.waitFor(() => expect(logEntries()).toEqual([]));
  });

  test("unbound: no key clears from the command line; clear still does", async () => {
    await renderConsole("mac", { "console.clear": [] });
    await seedLine();
    await pressInCommandLine("{Control>}l{/Control}");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(texts()).toEqual(["Placed ERC20 · 9 selectors"]);
    await userEvent.fill(input(), "clear");
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(logEntries()).toEqual([]));
  });

  test("a single-key remap never fires in the field: the key types", async () => {
    await renderConsole("mac", { "console.clear": ["x"] });
    await seedLine();
    await pressInCommandLine("x");
    await expect.element(input()).toHaveValue("x");
    expect(texts()).toEqual(["Placed ERC20 · 9 selectors"]);
  });

  test("clearsTheLog reads the binding in effect", () => {
    const ctrlL = { key: "l", code: "KeyL", ctrlKey: true, altKey: false, shiftKey: false, metaKey: false };
    const ctrlK = { ...ctrlL, key: "k", code: "KeyK" };
    expect([clearsTheLog(ctrlL, "mac"), clearsTheLog(ctrlL, "other")]).toEqual([true, false]);
    settings.set({ keymap: { "console.clear": ["Ctrl+k"] } });
    expect([clearsTheLog(ctrlL, "mac"), clearsTheLog(ctrlK, "mac"), clearsTheLog(ctrlK, "other")]).toEqual([false, true, true]);
    settings.set({ keymap: { "console.clear": [] } });
    expect(clearsTheLog(ctrlL, "mac")).toBe(false);
    settings.set({ keymap: DEFAULT_SETTINGS.keymap });
  });
});

describe("console.clear on the focused Log goes through the dispatcher (IR L35)", () => {
  beforeEach(() => onCleanup(installShortcuts()));

  test("macOS: Ctrl L on a focused log line clears the log", async () => {
    await renderConsole("mac");
    const line = await seedLine();
    (line.element() as HTMLElement).focus();
    await userEvent.keyboard("{Control>}l{/Control}");
    await vi.waitFor(() => expect(logEntries()).toEqual([]));
  });

  test("Windows and Linux: Ctrl L isn't bound, so the log stays", async () => {
    const clear = listBindings().find((b) => b.id === "console.clear");
    expect(clear?.keys.map((spec) => chordOf(spec, "other"))).toEqual([null]);
    await renderConsole("other");
    const line = await seedLine();
    (line.element() as HTMLElement).focus();
    await userEvent.keyboard("{Control>}l{/Control}");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(texts()).toEqual(["Placed ERC20 · 9 selectors"]);
  });

  test("remapped, the Log follows the new key too", async () => {
    await renderConsole("mac", { "console.clear": ["Ctrl+k"] });
    const line = await seedLine();
    (line.element() as HTMLElement).focus();
    await userEvent.keyboard("{Control>}l{/Control}");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(texts()).toEqual(["Placed ERC20 · 9 selectors"]);
    await userEvent.keyboard("{Control>}k{/Control}");
    await vi.waitFor(() => expect(logEntries()).toEqual([]));
  });
});

describe("Resolve N blockers to export · <key> takes problem.next's key (spec L661)", () => {
  const exportMenu = () => page.getByRole("button", { name: "Export", exact: true });
  const reasonOf = (name: string) => {
    const id = page.getByRole("menuitem", { name }).element().getAttribute("aria-describedby");
    return id ? (document.getElementById(id)?.textContent ?? null) : null;
  };

  test("default F8, a remap and no key, as the reason reads it", () => {
    const view: KeyView = { keymap: {}, singleKeys: true, platform: "other" };
    const reason = (blockers: number, v: KeyView) => resolveToExport(blockers, nextProblemKey(v));
    expect(reason(2, view)).toBe("Resolve 2 blockers to export · F8");
    expect(reason(1, { ...view, keymap: { "problem.next": ["F9"] } })).toBe("Resolve 1 blocker to export · F9");
    expect(reason(2, { ...view, keymap: { "problem.next": ["Mod+Shift+j"] } })).toBe("Resolve 2 blockers to export · Ctrl+Shift+J");
    expect(reason(2, { ...view, platform: "mac", keymap: { "problem.next": ["Mod+Shift+j"] } })).toBe("Resolve 2 blockers to export · ⇧⌘J");
    expect(reason(2, { ...view, keymap: { "problem.next": [] } })).toBe("Resolve 2 blockers to export");
    // A single-key remap while single keys are off isn't live, so the reason doesn't offer it.
    expect(reason(2, { ...view, singleKeys: false, keymap: { "problem.next": ["n"] } })).toBe("Resolve 2 blockers to export");
  });

  test("the Export menu's reasons name the remapped key (F8 by default: exports.browser.test.tsx)", async () => {
    await renderConsole("other", { "problem.next": ["F9"] }, collisionProject());
    await userEvent.click(exportMenu());
    await expect.element(page.getByRole("menuitem", { name: "Foundry script" })).toBeVisible();
    expect(reasonOf("Foundry script")).toBe("Resolve 2 blockers to export · F9");
    expect(reasonOf("Safe batch…")).toBe("Resolve 2 blockers to export · F9");
  });

  test("the Script tab's banner and buttons follow a remap while open", async () => {
    await renderConsole("other", {}, collisionProject());
    await userEvent.click(page.getByRole("tab", { name: "Script" }));
    await expect.element(page.getByText("Resolve 2 blockers to export · F8").first()).toBeVisible();
    settings.set({ keymap: { "problem.next": ["F9"] } });
    await expect.element(page.getByText("Resolve 2 blockers to export · F9").first()).toBeVisible();
    await expect.element(page.getByRole("button", { name: "Download" })).toHaveAccessibleDescription("Resolve 2 blockers to export · F9");
    settings.set({ keymap: { "problem.next": [] } });
    await expect.element(page.getByText("Resolve 2 blockers to export", { exact: true }).first()).toBeVisible();
  });
});
