import { describe, expect, test } from "vitest";
import { defineCommands, dialogComponent, getCommand, isPlaceholder, listBindings, listPaletteRows, pushEscape } from "@/contracts";
import { S2_COMMANDS } from "./definitions";
import { escapeDepth } from "./escape";

describe("discovery (contracts §5.3)", () => {
  test("the glob found S2's commands.ts and services.ts: real commands, the dialog and the Esc stack", () => {
    expect(isPlaceholder("ui.escape")).toBe(false);
    expect(isPlaceholder("shortcuts.open")).toBe(false);
    expect(getCommand("shortcuts.open").title({})).toBe("Keyboard shortcuts");
    expect(listBindings().find((b) => b.id === "shortcuts.open")?.keys).toEqual(["?"]);
    expect(listPaletteRows().some((r) => r.ref.id === "shortcuts.open")).toBe(true);
    expect(dialogComponent("keyboard-shortcuts")).not.toBeNull();
    const before = escapeDepth();
    const dispose = pushEscape(() => undefined);
    expect(escapeDepth()).toBe(before + 1);
    dispose();
    expect(escapeDepth()).toBe(before);
  });

  test("a second real registration throws; a command without an owner's registration stays a placeholder", () => {
    expect(() => defineCommands(S2_COMMANDS)).toThrow("Command ui.escape is already registered. WP-S2 registers it once.");
    expect(isPlaceholder("palette.open")).toBe(true);
    const state = getCommand("palette.open").enabled({} as never, {});
    expect(state).toEqual({ ok: false, reason: "Not built yet · WP-S6" });
  });
});
