import { describe, expect, test } from "bun:test";
import type { CommandId } from "@lattice-studio/core";
import type { KeyContext, KeySpec, ResolvedBinding } from "@/contracts";
import type { KeyInput } from "./key-spec";
import { reservedByBrowser, reservedReason, resolveKey, type KeyEnvironment } from "./resolve";

function binding(id: CommandId, keys: KeySpec[], keyContext?: KeyContext[], name?: string): ResolvedBinding {
  return {
    id: name ? `${id}#${name}` : id,
    ref: { id },
    defaults: keys,
    keys,
    ...(keyContext ? { keyContext } : {}),
  };
}

const SHEET: KeyContext[] = ["sheet"];
const BINDINGS: ResolvedBinding[] = [
  binding("layout.tidy", ["t"], SHEET),
  binding("sheet.zoomIn", ["=", "+"], SHEET),
  binding("sheet.zoom100", ["Shift+[Digit0]"], SHEET),
  binding("sheet.zoomFit", ["Shift+[Digit1]"], SHEET),
  binding("history.undo", ["Mod+z"], ["global", "sheet", "card-rows", "tree", "list", "menu", "dialog"]),
  binding("history.redo", ["Mod+Shift+z", { keys: "Ctrl+y", platform: "other" }], ["global", "sheet", "card-rows", "tree", "list", "menu", "dialog"]),
  binding("catalog.focusSearch", ["/"], ["global", "sheet", "card-rows"]),
  binding("shortcuts.open", ["?"], ["global", "sheet", "card-rows"]),
  binding("palette.open", ["Mod+k"], ["global", "sheet", "card-rows", "tree", "list", "text", "palette"]),
  binding("region.next", ["F6"], ["global"]),
  binding("region.focus", ["g"], ["global"], "inspector"),
  binding("selector.copy", ["Space"], ["card-rows"]),
  binding("console.clear", [{ keys: "Ctrl+l", platform: "mac" }], ["console", "text"]),
];

function press(key: string, code: string, mods: Partial<Omit<KeyInput, "key" | "code">> = {}): KeyInput {
  return { key, code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods };
}

function env(context: KeyContext, extra: Partial<KeyEnvironment> = {}): KeyEnvironment {
  return { bindings: BINDINGS, context, platform: "mac", singleKeys: true, ...extra };
}

function ran(event: KeyInput, e: KeyEnvironment): string[] | string {
  const decision = resolveKey(event, e);
  return decision.kind === "run" ? decision.matches.map((b) => b.id) : decision.kind;
}

describe("key contexts", () => {
  test("a shortcut is live only in the contexts it names; no keyContext means global", () => {
    expect(ran(press("t", "KeyT"), env("sheet"))).toEqual(["layout.tidy"]);
    expect(ran(press("t", "KeyT"), env("global"))).toBe("pass");
    expect(ran(press("z", "KeyZ", { metaKey: true }), env("dialog"))).toEqual(["history.undo"]);
    const unscoped = [{ id: "app.reload" as const, ref: { id: "app.reload" as const }, defaults: ["Mod+r"], keys: ["Mod+r"] }];
    expect(ran(press("r", "KeyR", { metaKey: true }), env("global", { bindings: unscoped }))).toEqual(["app.reload"]);
    expect(ran(press("r", "KeyR", { metaKey: true }), env("sheet", { bindings: unscoped }))).toBe("pass");
  });

  test("text fields keep their keys: ⌘Z is native text undo there", () => {
    expect(ran(press("z", "KeyZ", { metaKey: true }), env("text"))).toBe("pass");
    expect(ran(press("k", "KeyK", { metaKey: true }), env("text"))).toEqual(["palette.open"]);
  });

  test("single keys are inert while typing and inside trees, lists, menus, the console and the palette, even where listed", () => {
    const listed = BINDINGS.map((b) => (b.id === "shortcuts.open" ? { ...b, keyContext: [...(b.keyContext ?? []), "tree", "list", "menu", "console", "palette", "text"] as KeyContext[] } : b));
    for (const context of ["text", "tree", "list", "menu", "console", "palette"] as const) {
      expect(ran(press("?", "Slash", { shiftKey: true }), env(context, { bindings: listed }))).toBe("pass");
    }
    expect(ran(press("?", "Slash", { shiftKey: true }), env("sheet", { bindings: listed }))).toEqual(["shortcuts.open"]);
    // Modified shortcuts still work in a tree.
    expect(ran(press("z", "KeyZ", { metaKey: true }), env("tree"))).toEqual(["history.undo"]);
  });

  test("a card's rows take their own single keys", () => {
    expect(ran(press(" ", "Space"), env("card-rows"))).toEqual(["selector.copy"]);
    expect(ran(press("/", "Slash"), env("card-rows"))).toEqual(["catalog.focusSearch"]);
  });

  test("single keys switched off: none fire, modified ones still do", () => {
    const off = { singleKeys: false };
    expect(ran(press("t", "KeyT"), env("sheet", off))).toBe("pass");
    expect(ran(press("/", "Slash"), env("global", off))).toBe("pass");
    expect(ran(press("z", "KeyZ", { metaKey: true }), env("sheet", off))).toEqual(["history.undo"]);
  });

  test("a shortcut remapped to a single key follows the single-key rules", () => {
    const remapped = BINDINGS.map((b) => (b.id === "palette.open" ? { ...b, keys: ["p"] } : b));
    expect(ran(press("p", "KeyP"), env("sheet", { bindings: remapped }))).toEqual(["palette.open"]);
    expect(ran(press("p", "KeyP"), env("text", { bindings: remapped }))).toBe("pass");
    expect(ran(press("p", "KeyP"), env("sheet", { bindings: remapped, singleKeys: false }))).toBe("pass");
  });
});

describe("layouts", () => {
  test("digit shortcuts match the physical key first: ⇧0 on QWERTZ types = but stays 100%", () => {
    expect(ran(press("=", "Digit0", { shiftKey: true }), env("sheet"))).toEqual(["sheet.zoom100"]);
    expect(ran(press(")", "Digit0", { shiftKey: true }), env("sheet"))).toEqual(["sheet.zoom100"]);
    expect(ran(press("!", "Digit1", { shiftKey: true }), env("sheet"))).toEqual(["sheet.zoomFit"]);
    // AZERTY: ⇧1 types 1.
    expect(ran(press("1", "Digit1", { shiftKey: true }), env("sheet"))).toEqual(["sheet.zoomFit"]);
  });

  test("zoom in on =, + and keypad + on every layout", () => {
    expect(ran(press("=", "Equal"), env("sheet"))).toEqual(["sheet.zoomIn"]);
    expect(ran(press("+", "Equal", { shiftKey: true }), env("sheet"))).toEqual(["sheet.zoomIn"]);
    expect(ran(press("+", "BracketRight"), env("sheet"))).toEqual(["sheet.zoomIn"]);
    expect(ran(press("+", "NumpadAdd"), env("sheet"))).toEqual(["sheet.zoomIn"]);
  });

  test("QWERTY, QWERTZ, AZERTY and Cyrillic undo and tidy", () => {
    expect(ran(press("z", "KeyZ", { metaKey: true }), env("sheet"))).toEqual(["history.undo"]);
    expect(ran(press("z", "KeyY", { metaKey: true }), env("sheet"))).toEqual(["history.undo"]);
    expect(ran(press("z", "KeyW", { metaKey: true }), env("sheet"))).toEqual(["history.undo"]);
    expect(ran(press("я", "KeyZ", { metaKey: true }), env("sheet"))).toEqual(["history.undo"]);
    expect(ran(press("е", "KeyT"), env("sheet"))).toEqual(["layout.tidy"]);
    expect(ran(press("Z", "KeyZ", { metaKey: true, shiftKey: true }), env("sheet"))).toEqual(["history.redo"]);
    expect(ran(press("y", "KeyY", { ctrlKey: true }), env("sheet", { platform: "other" }))).toEqual(["history.redo"]);
    expect(ran(press("y", "KeyY", { ctrlKey: true }), env("sheet"))).toBe("pass");
  });

  test("a typed character beats another key's position", () => {
    // On a layout where the key at KeyT types "t" nothing falls back; a binding on the typed letter wins.
    const both = [binding("layout.tidy", ["t"], SHEET), binding("tool.hand", ["h"], SHEET)];
    expect(ran(press("t", "KeyH"), env("sheet", { bindings: both }))).toEqual(["layout.tidy"]);
  });
});

describe("what Studio leaves alone or always takes", () => {
  test("⌘/Ctrl with + − 0, ⌘F and ⌘L stay the browser's, whatever the keymap says", () => {
    const greedy = [binding("sheet.zoomIn", ["Mod+=", "Mod++"], SHEET), binding("console.find", ["Mod+f"], SHEET), binding("sheet.zoom100", ["Mod+0"], SHEET)];
    for (const event of [
      press("=", "Equal", { metaKey: true }),
      press("+", "Equal", { metaKey: true, shiftKey: true }),
      press("-", "Minus", { metaKey: true }),
      press("0", "Digit0", { metaKey: true }),
      press("f", "KeyF", { metaKey: true }),
      press("l", "KeyL", { metaKey: true }),
      press("а", "KeyF", { metaKey: true }),
    ]) {
      expect(ran(event, env("sheet", { bindings: greedy }))).toBe("pass");
    }
    expect(reservedByBrowser(press("l", "KeyL", { ctrlKey: true }), "mac")).toBe(false);
    expect(ran(press("l", "KeyL", { ctrlKey: true }), env("console"))).toEqual(["console.clear"]);
    expect(reservedByBrowser(press("l", "KeyL", { ctrlKey: true }), "other")).toBe(true);
  });

  test("the reason a spec can't be bound", () => {
    expect(reservedReason("Mod+=")).toBe("zoom");
    expect(reservedReason("Mod+-")).toBe("zoom");
    expect(reservedReason("Mod+0")).toBe("zoom");
    expect(reservedReason("Mod+f")).toBe("find");
    expect(reservedReason("Mod+l")).toBe("address");
    expect(reservedReason("Ctrl+l")).toBe("address");
    expect(reservedReason({ keys: "Ctrl+l", platform: "mac" })).toBeNull();
    expect(reservedReason("Tab")).toBe("tab");
    expect(reservedReason("Mod+Shift+f")).toBeNull();
    expect(reservedReason("t")).toBeNull();
  });

  test("⌘+arrow is consumed on the sheet even when nothing runs", () => {
    expect(ran(press("ArrowLeft", "ArrowLeft", { metaKey: true }), env("sheet"))).toBe("consume");
    expect(ran(press("ArrowRight", "ArrowRight", { metaKey: true }), env("card-rows"))).toBe("consume");
    expect(ran(press("ArrowLeft", "ArrowLeft", { metaKey: true }), env("global"))).toBe("pass");
    expect(ran(press("ArrowLeft", "ArrowLeft", { ctrlKey: true }), env("sheet", { platform: "other" }))).toBe("consume");
  });

  test("F6 and the region bindings are S9's", () => {
    expect(ran(press("F6", "F6"), env("global"))).toBe("pass");
    expect(ran(press("g", "KeyG"), env("global"))).toBe("pass");
  });
});
