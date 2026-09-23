/**
 * The shortcut grammar (contracts §5.3 `KeySpec`) and how a keydown matches it (spec L754, IR L1):
 * letters and symbols match the character the key types (`event.key`), so shortcuts follow the person's
 * layout; physical codes in brackets (`Shift+[Digit0]`) match `event.code` and win over typed characters;
 * a letter falls back to the key's position when the layout types a non-Latin character. Pure: the platform
 * and the event are passed in.
 */
import type { Platform } from "@lattice-studio/core";
import type { KeySpec } from "@/contracts";

/** The fields of a `KeyboardEvent` a shortcut is matched on. */
export type KeyInput = Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">;

/** A spec resolved for one platform: `Mod` is ⌘ (meta) on macOS and Ctrl elsewhere. */
export type Chord = {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  /** The typed character (lower-cased when it's a letter) or a named key (`Enter`, `ArrowLeft`, `F6`). */
  key?: string;
  /** A physical key (`Digit0`), from the `[Digit0]` form. */
  code?: string;
};

/** How a spec matched: by physical key, by typed character, or by a letter's position on a non-Latin layout. */
export type MatchTier = "code" | "key" | "position";

const MODIFIERS = new Set(["Mod", "Ctrl", "Alt", "Shift", "Meta"]);

/** The keys of a spec on `platform`, or null when the spec is limited to the other platform. */
export function specKeys(spec: KeySpec, platform: Platform): string | null {
  if (typeof spec === "string") return spec;
  return spec.platform === platform ? spec.keys : null;
}

/** Modifiers, then the key: `"+"` and `"Mod++"` name the + key. */
export function splitKeys(keys: string): string[] {
  if (keys === "+") return ["+"];
  if (keys.endsWith("++")) return [...keys.slice(0, -2).split("+"), "+"];
  return keys.split("+");
}

const isLetter = (key: string) => /^[a-z]$/i.test(key);

/** Parses `keys` for `platform`. Null when it isn't valid grammar. */
export function parseKeys(keys: string, platform: Platform): Chord | null {
  const parts = splitKeys(keys);
  const last = parts.pop();
  if (!last) return null;
  const chord: Chord = { ctrl: false, alt: false, shift: false, meta: false };
  for (const mod of parts) {
    switch (mod) {
      case "Mod":
        if (platform === "mac") chord.meta = true;
        else chord.ctrl = true;
        break;
      case "Ctrl": chord.ctrl = true; break;
      case "Alt": chord.alt = true; break;
      case "Shift": chord.shift = true; break;
      case "Meta": chord.meta = true; break;
      default: return null;
    }
  }
  if (MODIFIERS.has(last)) return null;
  const code = /^\[(.+)\]$/.exec(last)?.[1];
  if (code) chord.code = code;
  else if (last === "Space") chord.key = " ";
  else chord.key = last.length === 1 ? last.toLowerCase() : last;
  return chord;
}

/** The chord a spec means on `platform`, or null when it doesn't apply there or isn't valid. */
export function chordOf(spec: KeySpec, platform: Platform): Chord | null {
  const keys = specKeys(spec, platform);
  return keys === null ? null : parseKeys(keys, platform);
}

/**
 * A symbol or digit typed as a character already carries its Shift (`?` is ⇧/ on QWERTY and ⇧, on AZERTY),
 * so Shift only counts where the spec names it. Letters, codes and named keys compare Shift exactly, so
 * ⌘Z and ⇧⌘Z stay apart.
 */
function shiftFree(chord: Chord): boolean {
  return isSymbol(chord) && !chord.shift;
}

/** A symbol or digit typed as a character (not a letter, not Space). */
function isSymbol(chord: Chord): boolean {
  return chord.key !== undefined && chord.key.length === 1 && chord.key !== " " && !isLetter(chord.key);
}

/** A character a Latin layout types: printable ASCII. */
const isLatinCharacter = (key: string) => /^[\x20-\x7e]$/.test(key);

/**
 * How `chord` matches `event`, or null. Modifiers other than a symbol's Shift must match exactly. A letter
 * matches the typed character in either case, else falls back to the key in that letter's QWERTY position: on
 * a layout that typed a non-Latin character, or unconditionally for an Option chord on macOS, since Option
 * composes its own characters (including dead keys) on every Mac layout, US or not (FX13 item g). On "other",
 * Ctrl+Alt together is AltGr composing a character, not a real Ctrl+Alt chord, so it never falls back to a
 * position match there (FX13 item h).
 */
export function matchChord(chord: Chord, event: KeyInput, platform: Platform): MatchTier | null {
  if (event.ctrlKey !== chord.ctrl || event.altKey !== chord.alt || event.metaKey !== chord.meta) return null;
  if (!shiftFree(chord) && event.shiftKey !== chord.shift) return null;
  if (chord.code !== undefined) return event.code === chord.code ? "code" : null;
  const key = chord.key ?? "";
  if (key.length === 1) {
    if (event.key.toLowerCase() === key) return "key";
    if (platform === "other" && event.ctrlKey && event.altKey) return null;
    const optionOnMac = platform === "mac" && chord.alt;
    const foreign = optionOnMac || (event.key.length === 1 ? !isLatinCharacter(event.key) : event.key === "Dead" || event.key === "Unidentified");
    if (isLetter(key) && foreign && event.code === `Key${key.toUpperCase()}`) return "position";
    return null;
  }
  return event.key === key ? "key" : null;
}

/** How `spec` matches `event` on `platform`, or null. */
export function matchSpec(spec: KeySpec, event: KeyInput, platform: Platform): MatchTier | null {
  const chord = chordOf(spec, platform);
  return chord ? matchChord(chord, event, platform) : null;
}

/**
 * A character-key shortcut (WCAG 2.1.4): a letter, digit, symbol or physical character key with no modifier
 * but Shift. F-keys, Enter, Esc, Delete, Space and the arrows aren't. Settings → Keyboard can switch these
 * off, and they're inert while typing and inside trees, lists, menus, the console and the palette.
 */
export function isSingleKey(spec: KeySpec): boolean {
  const keys = typeof spec === "string" ? spec : spec.keys;
  const chord = parseKeys(keys, "other");
  if (!chord || chord.ctrl || chord.alt || chord.meta) return false;
  if (chord.code !== undefined) return /^(Digit|Key|Numpad|Minus|Equal|Slash|Backslash|Bracket|Semicolon|Quote|Comma|Period|Backquote|IntlBackslash)/.test(chord.code);
  return chord.key !== undefined && chord.key.length === 1 && chord.key !== " ";
}

/** Whether two chords are the same keypress (a symbol's Shift ignored, as when matching). */
export function sameChord(a: Chord, b: Chord): boolean {
  if (a.ctrl !== b.ctrl || a.alt !== b.alt || a.meta !== b.meta) return false;
  if (a.code !== b.code || a.key !== b.key) return false;
  return isSymbol(a) || a.shift === b.shift;
}

/** Whether two specs are the same keypress on some platform both apply to. */
export function sameKeys(a: KeySpec, b: KeySpec): boolean {
  for (const platform of ["mac", "other"] as const) {
    const ca = chordOf(a, platform);
    const cb = chordOf(b, platform);
    if (ca && cb && sameChord(ca, cb)) return true;
  }
  return false;
}

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "OS", "Hyper", "Super", "CapsLock", "Fn", "FnLock", "AltGraph"]);

/**
 * The spec a keypress records as (Settings → Keyboard's remap field): `Mod` for the platform's command key,
 * letters lower-cased, digits by physical key (`Shift+[Digit1]`), a letter typed on a non-Latin layout by its
 * position. Option+E/I/N/U (and `` ` ``) are dead keys on a US Mac keyboard, composing an accent instead of
 * typing a character: recorded by position too, so they can still be bound (FX13 item g). Null for a modifier
 * on its own, an unrecordable dead key, or a key it can't name.
 */
export function specFromEvent(event: KeyInput, platform: Platform): string | null {
  if (MODIFIER_KEYS.has(event.key) || event.key === "Unidentified") return null;
  const mods: string[] = [];
  const primary = platform === "mac" ? event.metaKey : event.ctrlKey;
  if (primary) mods.push("Mod");
  if (platform === "mac" ? event.ctrlKey : event.metaKey) mods.push(platform === "mac" ? "Ctrl" : "Meta");
  if (event.altKey) mods.push("Alt");
  let key: string;
  const digit = /^Digit(\d)$/.exec(event.code)?.[1];
  const letter = /^Key([A-Z])$/.exec(event.code)?.[1];
  if (digit !== undefined && (event.shiftKey || event.key !== digit)) {
    key = `[${event.code}]`;
  } else if (event.key === " ") {
    key = "Space";
  } else if (event.key.length === 1 && isLetter(event.key)) {
    key = event.key.toLowerCase();
  } else if (letter && (event.altKey || event.key === "Dead" || (event.key.length === 1 && !isLatinCharacter(event.key)))) {
    key = letter.toLowerCase();
  } else if (event.key === "Dead") {
    return null;
  } else {
    key = event.key;
  }
  const typedSymbol = key.length === 1 && !isLetter(key);
  if (event.shiftKey && !typedSymbol) mods.push("Shift");
  // "Mod++" names the + key (see `splitKeys`).
  return [...mods, key].join("+");
}
