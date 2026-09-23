import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { defineCommands, openDialog, pushEscape, provideServices, runCommand, session } from "@/contracts";
import { bufferedServices } from "@/contracts/services";
import { isolateContracts } from "@/contracts/test-support";
import { DIALOG_OPEN, NOTHING_TO_CLOSE, S2_COMMANDS } from "./definitions";
import { escapeDepth, pushEscapeHandler, runEscape } from "./escape";

let restore: () => void;
const disposers: (() => void)[] = [];
beforeEach(() => {
  restore = isolateContracts();
  disposers.push(provideServices({ pushEscape: pushEscapeHandler }));
  defineCommands(S2_COMMANDS);
});
afterEach(() => {
  while (disposers.length) disposers.pop()?.();
  restore();
  expect(escapeDepth()).toBe(0);
});

function push(handler: () => boolean | void): void {
  disposers.push(pushEscape(handler));
}

describe("Esc layering (IR L17)", () => {
  test("the top overlay first, then a mode, then a card's rows, then the selection", () => {
    session.set((s) => ({ selection: ["ERC20"], modes: { ...s.modes, moveTo: true, initOrder: true, rows: "ERC20" } }));
    const said: string[] = [];
    let tourShowing = true;
    push(() => {
      if (!tourShowing) return false;
      tourShowing = false;
      said.push("tour");
    });
    expect(runEscape()).toBe("handler");
    expect(said).toEqual(["tour"]);
    expect(session.get().modes.moveTo).toBe(true);

    expect(runEscape()).toBe("moveTo");
    expect(session.get().modes).toEqual({ moveTo: false, initOrder: true, rows: "ERC20" });
    expect(runEscape()).toBe("initOrder");
    expect(runEscape()).toBe("rows");
    expect(session.get().modes.rows).toBeNull();
    expect(session.get().selection).toEqual(["ERC20"]);
    expect(runEscape()).toBe("selection");
    expect(session.get().selection).toEqual([]);
    expect(runEscape()).toBeNull();
  });

  test("the last pushed handler runs first; false passes Esc down; a disposed handler is gone", () => {
    const calls: string[] = [];
    push(() => {
      calls.push("bottom");
    });
    const disposeTop = pushEscape(() => {
      calls.push("top");
      return false;
    });
    expect(runEscape()).toBe("handler");
    expect(calls).toEqual(["top", "bottom"]);
    disposeTop();
    calls.length = 0;
    runEscape();
    expect(calls).toEqual(["bottom"]);
  });

  test("a handler that throws is logged and passes Esc on", () => {
    const quiet = spyOn(console, "error").mockImplementation(() => undefined);
    session.set({ selection: ["ERC20"] });
    push(() => {
      throw new Error("boom");
    });
    expect(runEscape()).toBe("selection");
    expect(bufferedServices().log.at(-1)).toMatchObject({ tag: "Error", text: "Esc: boom" });
    expect(quiet).toHaveBeenCalledTimes(1);
    quiet.mockRestore();
  });
});

describe("S2's commands", () => {
  test("ui.escape is live in a list or a menu too, but not a dialog, the palette or a text field (FX13 item b)", () => {
    const escape = S2_COMMANDS.find((c) => c.id === "ui.escape");
    expect(escape?.keyContext).toEqual(["global", "sheet", "card-rows", "tree", "list", "menu", "console"]);
  });

  test("ui.escape run with nothing to leave says so", async () => {
    await runCommand({ id: "ui.escape" }, "api");
    expect(bufferedServices().log.at(-1)).toMatchObject({ tag: "Note", text: NOTHING_TO_CLOSE });
  });

  test("shortcuts.open opens the dialog, and never over another dialog", async () => {
    await runCommand({ id: "shortcuts.open" }, "api");
    expect(session.get().dialogs.map((d) => d.id)).toEqual(["keyboard-shortcuts"]);
    session.set({ dialogs: [] });
    openDialog("settings");
    const outcome = await runCommand({ id: "shortcuts.open" }, "keys");
    expect(outcome).toEqual({ ok: false, reason: DIALOG_OPEN });
    expect(session.get().dialogs.map((d) => d.id)).toEqual(["settings"]);
  });
});
