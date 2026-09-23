import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { commandState, defineCommands, runCommand, session, settings } from "@/contracts";
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
  test("settings.open pushes the settings dialog", async () => {
    const outcome = await runCommand({ id: "settings.open" }, "menu");
    expect(outcome.ok).toBe(true);
    expect(session.get().dialogs.map((d) => d.id)).toEqual(["settings"]);
  });

  test("about.open pushes the about dialog", async () => {
    await runCommand({ id: "about.open" }, "menu");
    expect(session.get().dialogs.map((d) => d.id)).toEqual(["about"]);
  });

  test("theme.set writes the setting and titles itself per theme", () => {
    expect(commandState({ id: "theme.set", args: { theme: "draft" } }).title).toBe("Set theme to Draft");
    void runCommand({ id: "theme.set", args: { theme: "draft" } }, "button");
    expect(settings.get().theme).toBe("draft");
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
