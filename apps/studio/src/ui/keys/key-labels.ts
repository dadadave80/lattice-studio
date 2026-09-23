import type { Platform } from "@lattice-studio/core";
import { formatKeys } from "@lattice-studio/core";
import type { KeySpec } from "@/contracts";

/** The keys of a spec, or null when the spec is limited to the other platform. */
export function specKeys(spec: KeySpec, platform: Platform): string | null {
  if (typeof spec === "string") return spec;
  return spec.platform === platform ? spec.keys : null;
}

/** The first spec that applies on this platform (what a chip or tooltip shows). */
export function firstKeys(specs: readonly KeySpec[] | KeySpec | undefined, platform: Platform): string | null {
  if (specs === undefined) return null;
  const list = Array.isArray(specs) ? specs : [specs as KeySpec];
  for (const spec of list) {
    const keys = specKeys(spec, platform);
    if (keys) return keys;
  }
  return null;
}

const NAMED: Record<string, string> = {
  Escape: "Esc",
  Space: "Space",
  Delete: "Delete",
  Backspace: "Backspace",
  PageUp: "Page Up",
  PageDown: "Page Down",
  ContextMenu: "Menu",
};

/** A spec's key token as people read it: `k` → `K`, `[Digit1]` → `1`, `Escape` → `Esc`. */
function displayToken(token: string): string {
  const code = /^\[(.+)]$/.exec(token)?.[1];
  if (code) return code.replace(/^(Digit|Key|Numpad)/, "").replace(/^Add$/, "+").replace(/^Subtract$/, "-");
  if (token.length === 1) return token.toUpperCase();
  return NAMED[token] ?? token;
}

/**
 * Key labels per platform (spec L689): `"Mod+k"` is ⌘K on macOS and Ctrl+K on Windows and Linux;
 * `"Shift+[Digit1]"` is ⇧1 or Shift+1.
 */
export function keyLabel(keys: string, platform: Platform): string {
  const tokens = keys.split("+");
  // "Mod++" (a literal plus): the last token is empty after the split.
  if (keys.endsWith("++")) tokens.splice(-2, 2, "+");
  const last = tokens.pop() ?? "";
  return formatKeys([...tokens, displayToken(last)].join("+"), platform);
}

const ARIA_MODIFIERS: Record<string, (p: Platform) => string> = {
  Mod: (p) => (p === "mac" ? "Meta" : "Control"),
  Ctrl: () => "Control",
  Alt: () => "Alt",
  Shift: () => "Shift",
  Meta: () => "Meta",
};

/**
 * The `aria-keyshortcuts` value for specs (WAI-ARIA 1.2: modifiers `Alt`, `Control`, `Shift`, `Meta`, then
 * the key's `KeyboardEvent.key`; several shortcuts separated by spaces). Empty when none applies.
 */
export function ariaKeyShortcuts(specs: readonly KeySpec[] | KeySpec | undefined, platform: Platform): string {
  if (specs === undefined) return "";
  const list = Array.isArray(specs) ? specs : [specs as KeySpec];
  const out: string[] = [];
  for (const spec of list) {
    const keys = specKeys(spec, platform);
    if (!keys) continue;
    const tokens = keys.split("+");
    const key = tokens.pop() ?? "";
    const code = /^\[(.+)]$/.exec(key)?.[1];
    const mapped = tokens.map((t) => ARIA_MODIFIERS[t]?.(platform) ?? t);
    const main = code ? code.replace(/^(Digit|Key)/, "") : key === "Space" ? "Space" : key.length === 1 ? key.toUpperCase() : key;
    out.push([...mapped, main].join("+"));
  }
  return out.join(" ");
}
