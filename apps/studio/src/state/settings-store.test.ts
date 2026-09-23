import { describe, expect, test } from "bun:test";
import { DEFAULT_SETTINGS } from "@/contracts";
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
    store.setState({ theme: "draft", nudge: { small: 4, large: 16 }, keymap: { "layout.tidy": ["Shift+t"] } });
    expect(JSON.parse(storage.data[SETTINGS_KEY] ?? "{}")).toMatchObject({ theme: "draft", nudge: { small: 4, large: 16 } });
    stop();
    store.setState({ theme: "shop" });
    expect(JSON.parse(storage.data[SETTINGS_KEY] ?? "{}").theme).toBe("draft");
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
    store.setState({ theme: "draft" });
    expect(store.getState().theme).toBe("draft");
    expect(createSettingsStore(null).store.getState()).toEqual(DEFAULT_SETTINGS);
  });
});
