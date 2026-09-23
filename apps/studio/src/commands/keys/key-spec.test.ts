import { describe, expect, test } from "bun:test";
import { isSingleKey, matchSpec, parseKeys, sameKeys, specFromEvent, type KeyInput } from "./key-spec";

/** A keydown as a layout produces it. */
function press(key: string, code: string, mods: Partial<Omit<KeyInput, "key" | "code">> = {}): KeyInput {
  return { key, code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods };
}

describe("the grammar", () => {
  test("Mod is ⌘ on macOS and Ctrl elsewhere; + and Mod++ name the plus key; brackets name a physical key", () => {
    expect(parseKeys("Mod+k", "mac")).toEqual({ ctrl: false, alt: false, shift: false, meta: true, key: "k" });
    expect(parseKeys("Mod+k", "other")).toEqual({ ctrl: true, alt: false, shift: false, meta: false, key: "k" });
    expect(parseKeys("+", "other")?.key).toBe("+");
    expect(parseKeys("Mod++", "mac")).toEqual({ ctrl: false, alt: false, shift: false, meta: true, key: "+" });
    expect(parseKeys("Shift+[Digit0]", "mac")).toEqual({ ctrl: false, alt: false, shift: true, meta: false, code: "Digit0" });
    expect(parseKeys("Space", "mac")?.key).toBe(" ");
    expect(parseKeys("Hyper+k", "mac")).toBeNull();
    expect(parseKeys("Mod+Shift", "mac")).toBeNull();
  });

  test("single keys: letters, digits, symbols and physical character keys with no modifier but Shift", () => {
    for (const spec of ["t", "?", "/", "=", "+", "-", "Shift+[Digit1]", "[NumpadAdd]", "Shift+t"]) expect(isSingleKey(spec)).toBe(true);
    for (const spec of ["Mod+k", "Alt+t", "F6", "Enter", "Escape", "Delete", "ArrowLeft", "Shift+ArrowLeft", "Space"]) expect(isSingleKey(spec)).toBe(false);
  });
});

describe("matching on real layouts", () => {
  test("QWERTY: letters by the typed character, Shift kept apart (⌘Z is not ⇧⌘Z)", () => {
    expect(matchSpec("t", press("t", "KeyT"), "mac")).toBe("key");
    expect(matchSpec("t", press("T", "KeyT", { shiftKey: true }), "mac")).toBeNull();
    expect(matchSpec("Mod+z", press("z", "KeyZ", { metaKey: true }), "mac")).toBe("key");
    expect(matchSpec("Mod+z", press("z", "KeyZ", { metaKey: true, shiftKey: true }), "mac")).toBeNull();
    expect(matchSpec("Mod+Shift+z", press("Z", "KeyZ", { ctrlKey: true, shiftKey: true }), "other")).toBe("key");
    expect(matchSpec("Mod+z", press("z", "KeyZ", { ctrlKey: true }), "mac")).toBeNull();
    expect(matchSpec("?", press("?", "Slash", { shiftKey: true }), "mac")).toBe("key");
    expect(matchSpec("Shift+[Digit1]", press("!", "Digit1", { shiftKey: true }), "mac")).toBe("code");
    expect(matchSpec("Shift+[Digit1]", press("1", "Digit1"), "mac")).toBeNull();
  });

  test("QWERTZ: Z types z where QWERTY has Y, and ⇧0 types = but stays the physical 0", () => {
    // The key labelled Z sits at KeyY on QWERTZ: ⌘Z follows the label.
    expect(matchSpec("Mod+z", press("z", "KeyY", { metaKey: true }), "mac")).toBe("key");
    expect(matchSpec("Mod+z", press("y", "KeyZ", { metaKey: true }), "mac")).toBeNull();
    const shift0 = press("=", "Digit0", { shiftKey: true });
    expect(matchSpec("Shift+[Digit0]", shift0, "other")).toBe("code");
    expect(matchSpec("=", shift0, "other")).toBe("key");
    // + is its own key on QWERTZ.
    expect(matchSpec("+", press("+", "BracketRight"), "other")).toBe("key");
  });

  test("AZERTY: digits need Shift, so the unshifted & is not ⇧1; ? is ⇧,", () => {
    expect(matchSpec("Shift+[Digit1]", press("1", "Digit1", { shiftKey: true }), "other")).toBe("code");
    expect(matchSpec("Shift+[Digit1]", press("&", "Digit1"), "other")).toBeNull();
    expect(matchSpec("?", press("?", "KeyM", { shiftKey: true }), "other")).toBe("key");
    // A typed at the QWERTY Q position still means A: letters follow the layout.
    expect(matchSpec("a", press("a", "KeyQ"), "other")).toBe("key");
    expect(matchSpec("q", press("a", "KeyQ"), "other")).toBeNull();
  });

  test("Cyrillic: a letter falls back to the key in its position", () => {
    expect(matchSpec("t", press("е", "KeyT"), "other")).toBe("position");
    expect(matchSpec("Mod+z", press("я", "KeyZ", { ctrlKey: true }), "other")).toBe("position");
    expect(matchSpec("t", press("е", "KeyE"), "other")).toBeNull();
    // Symbols never fall back: they match what's typed.
    expect(matchSpec("/", press(".", "Slash"), "other")).toBeNull();
    // Option on macOS types other characters: the letter's position still counts.
    expect(matchSpec("Alt+t", press("†", "KeyT", { altKey: true }), "mac")).toBe("position");
  });

  test("zoom in accepts =, + and the keypad +", () => {
    expect(matchSpec("=", press("=", "Equal"), "mac")).toBe("key");
    expect(matchSpec("+", press("+", "Equal", { shiftKey: true }), "mac")).toBe("key");
    expect(matchSpec("+", press("+", "NumpadAdd"), "mac")).toBe("key");
    expect(matchSpec("[NumpadAdd]", press("+", "NumpadAdd"), "mac")).toBe("code");
  });

  test("a spec limited to one platform applies only there", () => {
    const redo = { keys: "Ctrl+y", platform: "other" } as const;
    expect(matchSpec(redo, press("y", "KeyY", { ctrlKey: true }), "other")).toBe("key");
    expect(matchSpec(redo, press("y", "KeyY", { ctrlKey: true }), "mac")).toBeNull();
  });
});

describe("comparing specs", () => {
  test("the same keypress on a platform both apply to", () => {
    expect(sameKeys("Mod+k", "Meta+k")).toBe(true);
    expect(sameKeys("Mod+k", "Ctrl+k")).toBe(true);
    expect(sameKeys("Mod+k", "Mod+Shift+k")).toBe(false);
    expect(sameKeys("?", "Shift+?")).toBe(true);
    expect(sameKeys("t", "T")).toBe(true);
    expect(sameKeys({ keys: "Ctrl+y", platform: "other" }, { keys: "Ctrl+y", platform: "mac" })).toBe(false);
    expect(sameKeys("Shift+[Digit0]", "=")).toBe(false);
  });
});

describe("recording a keypress", () => {
  test("Mod for the platform's command key, letters lower-cased, digits by position, symbols as typed", () => {
    expect(specFromEvent(press("K", "KeyK", { metaKey: true, shiftKey: true }), "mac")).toBe("Mod+Shift+k");
    expect(specFromEvent(press("k", "KeyK", { ctrlKey: true }), "other")).toBe("Mod+k");
    expect(specFromEvent(press("k", "KeyK", { ctrlKey: true }), "mac")).toBe("Ctrl+k");
    expect(specFromEvent(press("!", "Digit1", { shiftKey: true }), "mac")).toBe("Shift+[Digit1]");
    expect(specFromEvent(press("&", "Digit1"), "other")).toBe("[Digit1]");
    expect(specFromEvent(press("1", "Digit1"), "other")).toBe("1");
    expect(specFromEvent(press("?", "Slash", { shiftKey: true }), "mac")).toBe("?");
    expect(specFromEvent(press("+", "Equal", { metaKey: true, shiftKey: true }), "mac")).toBe("Mod++");
    expect(specFromEvent(press("е", "KeyT"), "other")).toBe("t");
    expect(specFromEvent(press("ArrowLeft", "ArrowLeft", { shiftKey: true }), "mac")).toBe("Shift+ArrowLeft");
    expect(specFromEvent(press(" ", "Space"), "mac")).toBe("Space");
    expect(specFromEvent(press("Shift", "ShiftLeft", { shiftKey: true }), "mac")).toBeNull();
    expect(specFromEvent(press("Dead", "Quote"), "mac")).toBeNull();
  });

  test("a recorded spec matches the keypress it came from", () => {
    const events = [
      press("K", "KeyK", { metaKey: true, shiftKey: true }),
      press("!", "Digit1", { shiftKey: true }),
      press("е", "KeyT"),
      press("?", "Slash", { shiftKey: true }),
      press("+", "Equal", { metaKey: true, shiftKey: true }),
    ];
    for (const event of events) {
      const spec = specFromEvent(event, "mac");
      expect(spec).not.toBeNull();
      expect(matchSpec(spec ?? "", event, "mac")).not.toBeNull();
    }
  });
});
