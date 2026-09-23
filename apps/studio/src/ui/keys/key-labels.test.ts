import { describe, expect, test } from "bun:test";
import { ariaKeyShortcuts, firstKeys, isSingleKey, keyLabel } from "./key-labels";

describe("keyLabel", () => {
  test("per platform: ⌘ on macOS, Ctrl elsewhere (spec L689)", () => {
    expect(keyLabel("Mod+k", "mac")).toBe("⌘K");
    expect(keyLabel("Mod+k", "other")).toBe("Ctrl+K");
    expect(keyLabel("Mod+Shift+z", "mac")).toBe("⇧⌘Z");
    expect(keyLabel("Mod+Shift+z", "other")).toBe("Ctrl+Shift+Z");
  });

  test("physical codes read as the key's character", () => {
    expect(keyLabel("Shift+[Digit1]", "mac")).toBe("⇧1");
    expect(keyLabel("Shift+[Digit0]", "other")).toBe("Shift+0");
  });

  test("named keys", () => {
    expect(keyLabel("F6", "mac")).toBe("F6");
    expect(keyLabel("Escape", "other")).toBe("Esc");
    expect(keyLabel("Mod+Enter", "mac")).toBe("⌘⏎");
    expect(keyLabel("?", "mac")).toBe("?");
    expect(keyLabel("Mod++", "other")).toBe("Ctrl++");
  });
});

describe("firstKeys", () => {
  test("skips specs limited to the other platform", () => {
    const redo = [{ keys: "Ctrl+y", platform: "other" as const }, "Mod+Shift+z"];
    expect(firstKeys(redo, "mac")).toBe("Mod+Shift+z");
    expect(firstKeys(redo, "other")).toBe("Ctrl+y");
    expect(firstKeys(undefined, "mac")).toBeNull();
  });
});

describe("ariaKeyShortcuts", () => {
  test("WAI-ARIA names, space separated", () => {
    expect(ariaKeyShortcuts("Mod+k", "mac")).toBe("Meta+K");
    expect(ariaKeyShortcuts("Mod+k", "other")).toBe("Control+K");
    expect(ariaKeyShortcuts(["F6", "Ctrl+F6"], "other")).toBe("F6 Control+F6");
    expect(ariaKeyShortcuts("Shift+[Digit1]", "mac")).toBe("Shift+1");
    expect(ariaKeyShortcuts({ keys: "Ctrl+y", platform: "other" }, "mac")).toBe("");
  });
});

describe("isSingleKey", () => {
  test("characters with at most Shift are single-key shortcuts (WCAG 2.1.4)", () => {
    expect(isSingleKey("t")).toBe(true);
    expect(isSingleKey("?")).toBe(true);
    expect(isSingleKey("Shift+[Digit1]")).toBe(true);
    expect(isSingleKey("Mod+k")).toBe(false);
    expect(isSingleKey("F6")).toBe(false);
    expect(isSingleKey("Escape")).toBe(false);
    expect(isSingleKey("Alt+ArrowUp")).toBe(false);
  });
});
