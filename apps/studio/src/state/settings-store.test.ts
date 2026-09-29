import { describe, expect, test } from "bun:test";
import { DEFAULT_SETTINGS } from "@/contracts";
import { bufferedServices, clearServiceBuffers } from "@/contracts/services";
import { createSettingsStore, readSettings, SETTINGS_KEY, type SettingsStorage } from "./settings-store";

function memory(initial: Record<string, string> = {}): SettingsStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => data[key] ?? null,
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

describe("settings store", () => {
  test("starts from the defaults and writes every change back", () => {
    const storage = memory();
    const { store, stop } = createSettingsStore(storage);
    expect(store.getState()).toEqual(DEFAULT_SETTINGS);
    store.setState({ theme: "light", nudge: { small: 4, large: 16 }, keymap: { "layout.tidy": ["Shift+t"] } });
    expect(JSON.parse(storage.data[SETTINGS_KEY] ?? "{}")).toMatchObject({ theme: "light", nudge: { small: 4, large: 16 } });
    stop();
    store.setState({ theme: "dark" });
    expect(JSON.parse(storage.data[SETTINGS_KEY] ?? "{}").theme).toBe("light");
  });

  test("a new store reads what the last one saved", () => {
    const storage = memory();
    const first = createSettingsStore(storage);
    first.store.setState({ wheel: "zoom", singleKeys: false, rpc: { 11155111: "https://rpc.example" }, receiptTimeout: 240 });
    const second = createSettingsStore(storage);
    expect(second.store.getState()).toMatchObject({ wheel: "zoom", singleKeys: false, rpc: { 11155111: "https://rpc.example" }, receiptTimeout: 240 });
  });

  test("ignores values of the wrong type or outside their options, field by field", () => {
    const read = readSettings(JSON.stringify({
      theme: "neon", wheel: "zoom", nudge: { small: -1, large: 32 }, minimap: "yes", keymap: { "layout.tidy": [3] },
      rpc: { abc: "x", 1: 5 }, receiptTimeout: 0, deployAnnouncements: "all",
    }));
    expect(read).toEqual({ ...DEFAULT_SETTINGS, wheel: "zoom", deployAnnouncements: "all" });
    expect(readSettings("not json")).toEqual(DEFAULT_SETTINGS);
    expect(readSettings("[1,2]")).toEqual(DEFAULT_SETTINGS);
  });

  test("a theme saved under its old name reads as the theme it became: shop as dark, draft as light", () => {
    expect(readSettings(JSON.stringify({ theme: "shop" })).theme).toBe("dark");
    expect(readSettings(JSON.stringify({ theme: "draft" })).theme).toBe("light");
    expect(readSettings(JSON.stringify({ theme: "Shop" })).theme).toBe(DEFAULT_SETTINGS.theme);
    expect(readSettings(JSON.stringify({ theme: "constructor" })).theme).toBe(DEFAULT_SETTINGS.theme);
    expect(readSettings(JSON.stringify({ theme: 1 })).theme).toBe(DEFAULT_SETTINGS.theme);
  });

  test("a migrated theme is written back under its new name on the next change", () => {
    const storage = memory({ [SETTINGS_KEY]: JSON.stringify({ theme: "draft" }) });
    const { store } = createSettingsStore(storage);
    expect(store.getState().theme).toBe("light");
    store.setState({ wheel: "zoom" });
    expect(JSON.parse(storage.data[SETTINGS_KEY] ?? "{}")).toMatchObject({ theme: "light", wheel: "zoom" });
  });

  test("a stored __proto__ key is refused: defaults are kept, the built keymap's prototype is untouched, and it's logged once", () => {
    clearServiceBuffers();
    // A raw JSON string, not an object literal: JSON.parse keeps "__proto__" as an own property (the bug this
    // guards against), while `{ __proto__: … }` in JS source would set the literal's own prototype instead.
    // The value is a valid KeySpec array, so the old loop (`keymap[binding] = valid`) would have gone
    // through, setting the built keymap object's own prototype to it instead of the whole thing being refused.
    const read = readSettings('{"theme":"light","keymap":{"__proto__":["Shift+t"]}}');
    expect(read).toEqual(DEFAULT_SETTINGS);
    expect(Object.getPrototypeOf(read.keymap)).toBe(Object.prototype);
    const errors = bufferedServices().log.filter((line) => line.tag === "Error");
    expect(errors).toHaveLength(1);
    expect(errors[0]?.text).toContain("keymap.__proto__");
    clearServiceBuffers();
  });

  test("readSettings builds the keymap as own properties, not through the prototype, for an ordinary binding", () => {
    const read = readSettings(JSON.stringify({ keymap: { "layout.tidy": ["Shift+t"] } }));
    expect(Object.getPrototypeOf(read.keymap)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(read.keymap, "layout.tidy")).toBe(true);
  });

  test("blocked storage keeps working in memory", () => {
    const blocked: SettingsStorage = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    const { store } = createSettingsStore(blocked);
    store.setState({ theme: "light" });
    expect(store.getState().theme).toBe("light");
    expect(createSettingsStore(null).store.getState()).toEqual(DEFAULT_SETTINGS);
  });
});
