import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { commandState, defineCommands, doc, runCommand, session, settings } from "@/contracts";
import { helpLines, runConsoleLine } from "@/commands/console/router";
import { bufferedServices } from "@/contracts/services";
import { isolateContracts } from "@/contracts/test-support";
import { S10_COMMANDS } from "./commands";
import { resetTour, tourState } from "../tour/tour-state";

let restore: () => void;

beforeEach(() => {
  restore = isolateContracts();
  defineCommands(S10_COMMANDS);
});

afterEach(() => {
  restore();
  resetTour();
});

describe("S10's commands (contracts §5.3)", () => {
  test("settings.open pushes the settings dialog and logs it", async () => {
    expect(commandState({ id: "settings.open" }).title).toBe("Open Settings");
    const outcome = await runCommand({ id: "settings.open" }, "menu");
    expect(outcome.ok).toBe(true);
    expect(session.get().dialogs.map((d) => d.id)).toEqual(["settings"]);
    expect(bufferedServices().log.at(-1)).toMatchObject({ tag: "Note", text: "Opened Settings." });
  });

  test("about.open pushes the about dialog and logs it", async () => {
    expect(commandState({ id: "about.open" }).title).toBe("Open About");
    await runCommand({ id: "about.open" }, "menu");
    expect(session.get().dialogs.map((d) => d.id)).toEqual(["about"]);
    expect(bufferedServices().log.at(-1)).toMatchObject({ tag: "Note", text: "Opened About." });
  });

  test("theme.set writes the setting, titles itself per theme, and logs it", () => {
    expect(commandState({ id: "theme.set", args: { theme: "draft" } }).title).toBe("Set theme to Draft");
    void runCommand({ id: "theme.set", args: { theme: "draft" } }, "button");
    expect(settings.get().theme).toBe("draft");
    expect(bufferedServices().log.at(-1)).toMatchObject({ tag: "Note", text: "Theme: Draft." });
  });

  test("theme.set stays out of undo: history can't undo it (IR L71)", async () => {
    const before = doc.state();
    for (const theme of ["draft", "system", "shop"] as const) {
      await runCommand({ id: "theme.set", args: { theme } }, "button");
      expect(settings.get().theme).toBe(theme);
    }
    expect(doc.state().canUndo).toBe(false);
    expect(doc.state().lastChange).toBe(before.lastChange);
    expect(doc.state().project).toBe(before.project);
  });

  test("the theme verb (IR L158): case-insensitive, and confirms with the Theme line", async () => {
    expect(helpLines("theme")).toEqual([{ syntax: "theme <shop, draft or system>", id: "theme.set", aliases: [] }]);
    const cases = [["theme DRAFT", "draft", "Draft"], ["theme System", "system", "System"], ["theme shop", "shop", "Shop"]] as const;
    for (const [line, theme, label] of cases) {
      expect((await runConsoleLine(line)).ok).toBe(true);
      expect(settings.get().theme).toBe(theme);
      expect(bufferedServices().log.at(-1)).toMatchObject({ tag: "Note", text: `Theme: ${label}.` });
    }
  });

  test("the theme verb refuses anything else with the choices, and changes nothing", async () => {
    const refusals = [
      ["theme blue", "“blue” isn't a theme. Choose shop, draft or system."],
      ["theme dark mode", "“dark mode” isn't a theme. Choose shop, draft or system."],
      ["theme", "theme takes shop, draft or system."],
      // Keys every object inherits aren't themes.
      ...["constructor", "toString", "valueOf", "hasOwnProperty", "__proto__"].map(
        (key) => [`theme ${key}`, `“${key}” isn't a theme. Choose shop, draft or system.`] as const,
      ),
    ] as const;
    const before = settings.get().theme;
    for (const [line, reason] of refusals) {
      expect(await runConsoleLine(line)).toEqual({ ok: false, reason });
      expect(settings.get().theme).toBe(before);
      expect(bufferedServices().log.at(-1)).toMatchObject({ text: reason });
    }
  });

  test("theme.set refuses an inherited key through the API too, and writes nothing", async () => {
    const before = settings.get().theme;
    const ref = { id: "theme.set", args: { theme: "constructor" } } as unknown as Parameters<typeof runCommand>[0];
    expect(commandState(ref)).toMatchObject({ ok: false, reason: `"constructor" isn't a theme.` });
    expect((await runCommand(ref, "api")).ok).toBe(false);
    expect(settings.get().theme).toBe(before);
    expect(bufferedServices().log.some((line) => line.text.startsWith("Theme:"))).toBe(false);
  });

  test("tour.start starts the tour and disables itself while running; tour.end stops it", async () => {
    expect(tourState()).toEqual({ running: false, step: 0 });
    expect(commandState({ id: "tour.start" }).ok).toBe(true);
    await runCommand({ id: "tour.start" }, "menu");
    expect(tourState()).toEqual({ running: true, step: 0 });
    expect(commandState({ id: "tour.start" })).toMatchObject({ ok: false, reason: "The tour is already running." });
    expect(commandState({ id: "tour.end" }).ok).toBe(true);
    await runCommand({ id: "tour.end" }, "menu");
    expect(tourState().running).toBe(false);
  });

  test("tour.end is disabled while the tour isn't running", () => {
    expect(commandState({ id: "tour.end" })).toMatchObject({ ok: false, reason: "The tour isn't running." });
  });
});
