import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { command, defineCommands, listBindings, settings, type Command } from "@/contracts";
import { isolateContracts } from "@/contracts/test-support";
import { checkRemap, findConflicts, isRemapped, remapBinding, resetBinding, resetKeymap } from "./keymap";

const ok = () => ({ ok: true as const });
const noop = () => undefined;

const COMMANDS: Command[] = [
  command({ id: "history.undo", title: () => "Undo", category: "Session", keys: ["Mod+z"], keyContext: ["global", "sheet"], enabled: ok, run: noop }),
  command({ id: "layout.tidy", title: () => "Tidy", category: "Sheet", keys: ["t"], keyContext: ["sheet"], enabled: ok, run: noop }),
  command({ id: "tool.hand", title: () => "Hand tool", category: "Sheet", keys: ["h"], keyContext: ["sheet"], enabled: ok, run: noop }),
  command({ id: "palette.open", title: () => "Command palette", category: "Session", keys: ["Mod+k"], keyContext: ["global", "sheet", "text"], enabled: ok, run: noop }),
  command({ id: "console.clear", title: () => "Clear the log", category: "Console", keys: [{ keys: "Ctrl+l", platform: "mac" }], keyContext: ["console"], enabled: ok, run: noop }),
  command({ id: "sheet.zoomFit", title: () => "Zoom to fit", category: "Sheet", keys: ["Shift+[Digit1]"], keyContext: ["sheet"], enabled: ok, run: noop }),
  command({
    id: "region.focus",
    title: () => "Go to region",
    category: "Session",
    bindings: [{ name: "inspector", keys: [], args: { region: "inspector" }, label: "Go to inspector" }],
    keyContext: ["global"],
    enabled: ok,
    run: noop,
  }),
];

let restore: () => void;
beforeEach(() => {
  restore = isolateContracts();
  defineCommands(COMMANDS);
});
afterEach(() => restore());

const keysOf = (id: string) => listBindings().find((b) => b.id === id)?.keys;

describe("conflicts", () => {
  test("the same keys in a context both are live in", () => {
    const conflicts = findConflicts("tool.hand", ["t"]);
    expect(conflicts.map((c) => [c.binding.id, c.title, c.keys])).toEqual([["layout.tidy", "Tidy", "t"]]);
    // Undo is live on the sheet too, and Mod+z there is ⌘Z whatever the platform.
    expect(findConflicts("layout.tidy", ["Mod+z"]).map((c) => c.binding.id)).toEqual(["history.undo"]);
  });

  test("no conflict in contexts that never meet, or on different platforms", () => {
    expect(findConflicts("console.clear", ["t"])).toEqual([]);
    expect(findConflicts("tool.hand", [{ keys: "Ctrl+l", platform: "other" }])).toEqual([]);
  });

  test("checkRemap says why, with the keys as people read them", () => {
    expect(checkRemap("tool.hand", ["t"], { platform: "mac" })?.reason).toBe("T is already used for Tidy. Replace it or choose another key.");
    expect(checkRemap("layout.tidy", ["Mod+k"], { platform: "mac" })?.reason).toBe("⌘K is already used for Command palette. Replace it or choose another key.");
    expect(checkRemap("layout.tidy", ["Mod+k"], { platform: "other" })?.reason).toBe("Ctrl+K is already used for Command palette. Replace it or choose another key.");
    expect(checkRemap("tool.hand", ["g"], { platform: "mac" })).toBeNull();
  });

  test("keys the browser keeps, Tab and nonsense are refused, each with what to do (FX13 item i)", () => {
    expect(checkRemap("layout.tidy", ["Mod+="], { platform: "mac" })?.reason).toBe("⌘= stays browser zoom. Choose another key.");
    expect(checkRemap("layout.tidy", ["Mod+f"], { platform: "other" })?.reason).toBe("Ctrl+F stays browser find. Choose another key.");
    expect(checkRemap("layout.tidy", ["Mod+l"], { platform: "mac" })?.reason).toBe("⌘L stays the address bar. Choose another key.");
    expect(checkRemap("layout.tidy", ["Tab"], { platform: "mac" })?.reason).toBe("Tab moves between controls. Choose another key.");
    expect(checkRemap("layout.tidy", ["Hyper+t"], { platform: "mac" })?.reason).toBe("“Hyper+t” isn't a key Studio can bind.");
    expect(checkRemap("sheet.zoomIn", ["x"], { platform: "mac" })?.reason).toBe("“sheet.zoomIn” isn't a shortcut.");
  });

  test("Mod+W/T/N/Q, Mod+R and Mod+P are refused too (FX13 item f)", () => {
    expect(checkRemap("layout.tidy", ["Mod+w"], { platform: "mac" })?.reason).toBe("⌘W closes the tab; the browser never delivers it to Studio. Choose another key.");
    expect(checkRemap("layout.tidy", ["Mod+r"], { platform: "mac" })?.reason).toBe("⌘R would block the browser's reload. Choose another key.");
    expect(checkRemap("layout.tidy", ["Mod+p"], { platform: "mac" })?.reason).toBe("⌘P would block the browser's print. Choose another key.");
  });

  test("a Ctrl chord kept for the browser only on the other platform is scoped to this one and allowed (FX13 item a)", () => {
    expect(checkRemap("layout.tidy", ["Ctrl+l"], { platform: "mac" })).toBeNull();
    expect(checkRemap("layout.tidy", ["Ctrl+f"], { platform: "mac" })).toBeNull();
    expect(checkRemap("layout.tidy", ["Ctrl+0"], { platform: "mac" })).toBeNull();
    // Still refused where it really is the browser's: Windows and Linux keep Ctrl+L for the address bar.
    expect(checkRemap("layout.tidy", ["Ctrl+l"], { platform: "other" })?.reason).toBe("Ctrl+L stays the address bar. Choose another key.");
  });

  test("a character spec shaped like Shift+digit conflicts with the code spec it can never win against (FX13 item j)", () => {
    expect(checkRemap("tool.hand", ["Shift+1"], { platform: "mac" })?.reason).toBe("⇧1 is already used for Zoom to fit. Replace it or choose another key.");
    expect(findConflicts("tool.hand", ["Shift+1"]).map((c) => c.binding.id)).toEqual(["sheet.zoomFit"]);
  });

  test("the Shift+digit shadow works the other way too: remapping to the code spec while a character one is live (CR4)", () => {
    // Digit 2 is free in the fixture, so this only exercises the shadow, not an exact-match conflict too.
    const keymap = { "tool.hand": ["Shift+2"] };
    expect(findConflicts("layout.tidy", ["Shift+[Digit2]"], keymap).map((c) => c.binding.id)).toEqual(["tool.hand"]);
    expect(checkRemap("layout.tidy", ["Shift+[Digit2]"], { keymap, platform: "mac" })?.reason).toBe(
      "⇧2 is already used for Hand tool. Replace it or choose another key.",
    );
  });
});

describe("remapping", () => {
  test("a free key remaps and says so; the keymap holds it", () => {
    const result = remapBinding("tool.hand", ["g"], { platform: "mac" });
    expect(result).toEqual({ ok: true, text: "Hand tool is now G." });
    expect(keysOf("tool.hand")).toEqual(["g"]);
    expect(settings.get().keymap).toEqual({ "tool.hand": ["g"] });
    expect(isRemapped("tool.hand")).toBe(true);
  });

  test("a taken key is refused unless replacing, which takes it from the other binding and says so (FX13 item d)", () => {
    const refused = remapBinding("tool.hand", ["t"], { platform: "mac" });
    expect(refused.ok).toBe(false);
    expect(settings.get().keymap).toEqual({});
    const taken = remapBinding("tool.hand", ["t"], { platform: "mac", replace: true });
    expect(taken).toEqual({ ok: true, text: "Hand tool is now T. Tidy has no shortcut now." });
    expect(keysOf("tool.hand")).toEqual(["t"]);
    expect(keysOf("layout.tidy")).toEqual([]);
  });

  test("replacing never overrides a refusal for the browser's keys", () => {
    expect(remapBinding("layout.tidy", ["Mod+0"], { platform: "mac", replace: true }).ok).toBe(false);
    expect(settings.get().keymap).toEqual({});
  });

  test("an empty list unbinds; the defaults clear the override; Reset puts one or all back and says so (FX13 item d)", () => {
    expect(remapBinding("layout.tidy", [], { platform: "mac" })).toEqual({ ok: true, text: "Tidy has no shortcut now." });
    expect(keysOf("layout.tidy")).toEqual([]);
    remapBinding("layout.tidy", ["t"], { platform: "mac" });
    expect(settings.get().keymap).toEqual({});
    remapBinding("layout.tidy", ["y"], { platform: "mac" });
    remapBinding("tool.hand", ["g"], { platform: "mac" });
    expect(resetBinding("layout.tidy")).toBe("Tidy is back to its default.");
    expect(resetBinding("layout.tidy")).toBe("Tidy is already at its default.");
    expect(keysOf("layout.tidy")).toEqual(["t"]);
    expect(keysOf("tool.hand")).toEqual(["g"]);
    expect(resetKeymap()).toBe("Reset 1 shortcut to its default.");
    expect(keysOf("tool.hand")).toEqual(["h"]);
    expect(resetKeymap()).toBe("Every shortcut is already at its default.");
  });

  test("a Ctrl chord kept for the browser only elsewhere is stored scoped to this platform (FX13 item a)", () => {
    const result = remapBinding("layout.tidy", ["Ctrl+l"], { platform: "mac" });
    expect(result).toEqual({ ok: true, text: "Tidy is now ⌃L." });
    expect(keysOf("layout.tidy")).toEqual([{ keys: "Ctrl+l", platform: "mac" }]);
  });

  test("a binding with arguments remaps on its own, and duplicates collapse", () => {
    const result = remapBinding("region.focus#inspector", ["Alt+i", "Alt+I"], { platform: "other" });
    expect(result).toEqual({ ok: true, text: "Go to inspector is now Alt+I." });
    expect(keysOf("region.focus#inspector")).toEqual(["Alt+i"]);
  });
});
