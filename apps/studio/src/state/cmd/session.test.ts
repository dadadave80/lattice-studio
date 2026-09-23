import { describe, expect, test } from "bun:test";
import { EVERYWHERE, specLive } from "@/commands";
import type { Command, KeyContext, ResolvedBinding } from "@/contracts";
import { redoCommand, undoCommand } from "./session";

function bindingOf(command: Command): Pick<ResolvedBinding, "keyContext"> {
  const keyContext: KeyContext[] | undefined = command.keyContext;
  return keyContext ? { keyContext } : {};
}

describe("undo and redo contexts (FX13)", () => {
  test("live everywhere but text: the console and the palette were missing", () => {
    for (const command of [undoCommand, redoCommand]) {
      expect(command.keyContext).toContain("console");
      expect(command.keyContext).toContain("palette");
      expect(command.keyContext).not.toContain("text");
      expect(command.keyContext).toEqual(EVERYWHERE.filter((c) => c !== "text"));
    }
  });

  test("⌘Z is live with focus in the console log and inert in a text field", () => {
    const binding = bindingOf(undoCommand);
    expect(specLive("Mod+z", binding, "console", "mac", true)).toBe(true);
    expect(specLive("Mod+z", binding, "text", "mac", true)).toBe(false);
  });

  test("⇧⌘Z is live with focus in the palette", () => {
    const binding = bindingOf(redoCommand);
    expect(specLive("Mod+Shift+z", binding, "palette", "mac", true)).toBe(true);
  });
});
