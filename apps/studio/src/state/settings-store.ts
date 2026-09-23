/**
 * The settings store (contracts §5.1), persisted to localStorage. Reads and writes are guarded: private
 * windows, blocked storage and quota errors fall back to the defaults and keep working in memory. Stored values
 * are checked field by field, so a hand-edited or older entry can't put a wrong type into the store.
 */
import { createStore, type StoreApi } from "zustand/vanilla";
import { DEFAULT_SETTINGS, type KeySpec, type SettingsState } from "@/contracts";

/** The localStorage key. Bump the version when a field changes meaning. */
export const SETTINGS_KEY = "lattice-studio.settings.v1";

/** The subset of `Storage` the store uses, so tests can pass a fake. */
export type SettingsStorage = Pick<Storage, "getItem" | "setItem">;

function browserStorage(): SettingsStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

type Json = unknown;

function isRecord(value: Json): value is Record<string, Json> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function oneOf<T extends string>(value: Json, options: readonly T[]): value is T {
  return typeof value === "string" && (options as readonly string[]).includes(value);
}

function positive(value: Json): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/** The stored settings that pass their checks, over the defaults. */
export function readSettings(raw: string | null): SettingsState {
  const out: SettingsState = structuredClone(DEFAULT_SETTINGS);
  if (raw === null) return out;
  let stored: Json;
  try {
    stored = JSON.parse(raw);
  } catch {
    return out;
  }
  if (!isRecord(stored)) return out;
  const s = stored;
  if (oneOf(s.theme, ["shop", "draft", "system"] as const)) out.theme = s.theme;
  if (oneOf(s.reduceMotion, ["system", "on", "off"] as const)) out.reduceMotion = s.reduceMotion;
  if (oneOf(s.wheel, ["pan", "zoom"] as const)) out.wheel = s.wheel;
  if (isRecord(s.nudge) && positive(s.nudge.small) && positive(s.nudge.large)) {
    out.nudge = { small: s.nudge.small, large: s.nudge.large };
  }
  if (typeof s.minimap === "boolean") out.minimap = s.minimap;
  if (typeof s.singleKeys === "boolean") out.singleKeys = s.singleKeys;
  if (isRecord(s.keymap)) {
    const keymap: SettingsState["keymap"] = {};
    for (const [binding, keys] of Object.entries(s.keymap)) {
      if (!Array.isArray(keys)) continue;
      const valid = keys.filter(
        (k: Json): k is KeySpec =>
          typeof k === "string" || (isRecord(k) && typeof k.keys === "string" && oneOf(k.platform, ["mac", "other"] as const)),
      );
      if (valid.length === keys.length) (keymap as Record<string, KeySpec[]>)[binding] = valid;
    }
    out.keymap = keymap;
  }
  if (isRecord(s.rpc)) {
    const rpc: Record<number, string> = {};
    for (const [chain, url] of Object.entries(s.rpc)) {
      const id = Number(chain);
      if (Number.isSafeInteger(id) && id > 0 && typeof url === "string") rpc[id] = url;
    }
    out.rpc = rpc;
  }
  if (typeof s.walletConnect === "boolean") out.walletConnect = s.walletConnect;
  if (oneOf(s.defaultPath, ["factory", "createx"] as const)) out.defaultPath = s.defaultPath;
  if (positive(s.receiptTimeout)) out.receiptTimeout = s.receiptTimeout;
  if (oneOf(s.deployAnnouncements, ["errors", "all", "none"] as const)) out.deployAnnouncements = s.deployAnnouncements;
  if (typeof s.keepLog === "boolean") out.keepLog = s.keepLog;
  return out;
}

/**
 * A settings store that starts from `storage` and writes every change back. Returns the store and a disposer
 * that stops writing.
 */
export function createSettingsStore(storage: SettingsStorage | null = browserStorage()): {
  store: StoreApi<SettingsState>;
  stop: () => void;
} {
  let raw: string | null = null;
  try {
    raw = storage?.getItem(SETTINGS_KEY) ?? null;
  } catch {
    raw = null;
  }
  const store = createStore<SettingsState>(() => readSettings(raw));
  const stop = store.subscribe((state) => {
    try {
      storage?.setItem(SETTINGS_KEY, JSON.stringify(state));
    } catch {
      // Storage full or blocked: the settings still apply for this session.
    }
  });
  return { store, stop };
}
