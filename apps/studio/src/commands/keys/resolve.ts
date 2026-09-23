/**
 * What a keydown does (spec L749-L755, IR L1-L38), decided without touching the DOM or the stores: the
 * dispatcher passes in the key context, the platform, the bindings after the keymap and whether single-key
 * shortcuts are on.
 */
import type { Platform } from "@lattice-studio/core";
import { KEY_CONTEXTS, type KeyContext, type KeySpec, type ResolvedBinding } from "@/contracts";
import { chordOf, isSingleKey, matchSpec, type Chord, type KeyInput, type MatchTier } from "./key-spec";

/** Contexts where single-key shortcuts never fire, even when a binding lists them (spec L753, WCAG 2.1.4). */
export const SINGLE_KEY_INERT: ReadonlySet<KeyContext> = new Set<KeyContext>(["text", "tree", "list", "menu", "console", "palette"]);

/** Every key context: for a shortcut that is live everywhere, typing included. */
export const EVERYWHERE: readonly KeyContext[] = KEY_CONTEXTS;

/** Where single-key shortcuts can be live ("/" and "?": "wherever single keys are active", IR L33-L34). */
export const WHEREVER_SINGLE_KEYS: readonly KeyContext[] = ["global", "sheet", "card-rows"];

/** A binding without `keyContext` is live in the `global` context only. */
export const DEFAULT_KEY_CONTEXT: readonly KeyContext[] = ["global"];

/** The contexts a binding is live in. */
export function contextsOf(binding: Pick<ResolvedBinding, "keyContext">): readonly KeyContext[] {
  return binding.keyContext ?? DEFAULT_KEY_CONTEXT;
}

/** Whether `spec` can fire in `context`: its platform, its binding's contexts and the single-key rules. */
export function specLive(
  spec: KeySpec,
  binding: Pick<ResolvedBinding, "keyContext">,
  context: KeyContext,
  platform: Platform,
  singleKeys: boolean,
): boolean {
  if (!chordOf(spec, platform)) return false;
  if (!contextsOf(binding).includes(context)) return false;
  if (isSingleKey(spec) && (!singleKeys || SINGLE_KEY_INERT.has(context))) return false;
  return true;
}

// ---------------------------------------------------------------------------------------------------------
// Keys the browser keeps (IR L38)

const ZOOM_KEYS = new Set(["+", "=", "-", "_", "0"]);
const ZOOM_CODES = new Set(["Equal", "Minus", "Digit0", "NumpadAdd", "NumpadSubtract", "Numpad0"]);

/**
 * ⌘/Ctrl with +, − or 0 stays browser zoom, which low-vision users rely on; ⌘/Ctrl F stays browser find;
 * ⌘/Ctrl L stays the address bar (IR L38). Studio never consumes these, whatever the keymap says.
 */
export function reservedByBrowser(event: KeyInput, platform: Platform): boolean {
  const primary = platform === "mac" ? event.metaKey : event.ctrlKey;
  if (!primary || event.altKey) return false;
  if (ZOOM_KEYS.has(event.key) || ZOOM_CODES.has(event.code)) return true;
  if (event.shiftKey) return false;
  const key = event.key.toLowerCase();
  if (key === "f" || key === "l") return true;
  // A non-Latin layout: the browser finds by the key's position.
  const foreign = event.key.length !== 1 || !/^[\x20-\x7e]$/.test(event.key);
  return foreign && (event.code === "KeyF" || event.code === "KeyL");
}

/** Why `chord` can't be a shortcut, or null. */
function reservedChordReason(chord: Chord, platform: Platform): "zoom" | "find" | "address" | "tab" | null {
  const primary = platform === "mac" ? chord.meta : chord.ctrl;
  if (chord.key === "Tab") return "tab";
  if (!primary || chord.alt) return null;
  if ((chord.key && ZOOM_KEYS.has(chord.key)) || (chord.code && ZOOM_CODES.has(chord.code))) return "zoom";
  if (chord.shift) return null;
  if (chord.key === "f" || chord.code === "KeyF") return "find";
  if (chord.key === "l" || chord.code === "KeyL") return "address";
  return null;
}

/** Why `spec` is kept for the browser or for moving focus on some platform, or null when it's free to bind. */
export function reservedReason(spec: KeySpec): "zoom" | "find" | "address" | "tab" | null {
  for (const platform of ["mac", "other"] as const) {
    const chord = chordOf(spec, platform);
    const reason = chord ? reservedChordReason(chord, platform) : null;
    if (reason) return reason;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------
// Resolving a keydown

export type KeyEnvironment = {
  /** The bindings after the keymap (`listBindings()`). */
  bindings: readonly ResolvedBinding[];
  /** The key context of the event's target (`keyContextOf`). */
  context: KeyContext;
  platform: Platform;
  /** Settings → Keyboard: single-key shortcuts on. */
  singleKeys: boolean;
};

export type KeyDecision =
  /** Not Studio's: leave the event alone. */
  | { kind: "pass" }
  /** Studio's, but nothing runs: consume it so the browser doesn't act (⌘+arrow on the sheet). */
  | { kind: "consume" }
  /** Run one of these bindings, all matching at the best tier (the dispatcher prefers an enabled one). */
  | { kind: "run"; matches: ResolvedBinding[]; tier: MatchTier };

/** S9 handles every region binding and every F6 in the capture phase (spec L743). */
function regionOwned(binding: ResolvedBinding): boolean {
  return binding.ref.id.startsWith("region.");
}

const ARROWS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]);
const TIERS: readonly MatchTier[] = ["code", "key", "position"];

/**
 * What `event` does. Order: F6 and the browser's keys pass; then the live bindings matched by physical key
 * (⇧0 ⇧1 ⇧2 before the characters Shift makes of digits), then by typed character, then letters by
 * position on a non-Latin layout; then ⌘+arrow is consumed on the sheet even when nothing runs.
 */
export function resolveKey(event: KeyInput, env: KeyEnvironment): KeyDecision {
  if (event.key === "F6") return { kind: "pass" };
  if (reservedByBrowser(event, env.platform)) return { kind: "pass" };
  const live = env.bindings
    .filter((b) => !regionOwned(b))
    .map((b) => ({ binding: b, specs: b.keys.filter((k) => specLive(k, b, env.context, env.platform, env.singleKeys)) }))
    .filter((c) => c.specs.length > 0);
  for (const tier of TIERS) {
    const matches = live
      .filter((c) => c.specs.some((spec) => matchSpec(spec, event, env.platform) === tier))
      .map((c) => c.binding);
    if (matches.length) return { kind: "run", matches, tier };
  }
  const primary = env.platform === "mac" ? event.metaKey : event.ctrlKey;
  if (primary && ARROWS.has(event.key) && (env.context === "sheet" || env.context === "card-rows")) return { kind: "consume" };
  return { kind: "pass" };
}
