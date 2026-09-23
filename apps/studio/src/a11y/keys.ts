/**
 * Just enough of the key grammar (contracts §5.3, `KeySpec`) to match the region bindings in the capture
 * phase, before S2's dispatcher could see them (spec L743). Pure: the platform and the event are passed in.
 */
import type { Platform } from "@lattice-studio/core";
import type { KeySpec } from "@/contracts";

/** The fields of a `KeyboardEvent` a shortcut is matched on. */
export type KeyInput = Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">;

type Parsed = { ctrl: boolean; alt: boolean; shift: boolean; meta: boolean; key?: string; code?: string };

/** ⌘ on macOS, Ctrl elsewhere, from the browser's own report. */
export function currentPlatform(): Platform {
  if (typeof navigator === "undefined") return "other";
  const data = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  const name = data?.platform || navigator.platform || navigator.userAgent;
  return /mac|iphone|ipad|ipod/i.test(name) ? "mac" : "other";
}

function parse(keys: string, platform: Platform): Parsed | null {
  const parts = keys.split("+");
  // "Mod++" is the + key.
  if (keys.endsWith("++")) parts.splice(-2, 2, "+");
  const last = parts.pop();
  if (!last) return null;
  const parsed: Parsed = { ctrl: false, alt: false, shift: false, meta: false };
  for (const mod of parts) {
    switch (mod) {
      case "Mod":
        if (platform === "mac") parsed.meta = true;
        else parsed.ctrl = true;
        break;
      case "Ctrl": parsed.ctrl = true; break;
      case "Alt": parsed.alt = true; break;
      case "Shift": parsed.shift = true; break;
      case "Meta": parsed.meta = true; break;
      default: return null;
    }
  }
  const code = /^\[(.+)\]$/.exec(last);
  if (code?.[1]) parsed.code = code[1];
  else parsed.key = last === "Space" ? " " : last;
  return parsed;
}

/** Whether `event` is the shortcut `spec` on `platform`. Modifiers must match exactly. */
export function matchesKey(spec: KeySpec, event: KeyInput, platform: Platform): boolean {
  if (typeof spec !== "string" && spec.platform !== platform) return false;
  const parsed = parse(typeof spec === "string" ? spec : spec.keys, platform);
  if (!parsed) return false;
  if (event.ctrlKey !== parsed.ctrl || event.altKey !== parsed.alt || event.metaKey !== parsed.meta) return false;
  const key = parsed.key ?? "";
  // A typed character already carries its Shift ("?"), so Shift only counts where the spec names it.
  const typed = key.length === 1 && !parsed.shift;
  if (!typed && event.shiftKey !== parsed.shift) return false;
  if (parsed.code !== undefined) return event.code === parsed.code;
  return key.length === 1 ? event.key.toLowerCase() === key.toLowerCase() : event.key === key;
}
