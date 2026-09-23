/**
 * Remapping (spec L633, L753): Settings → Keyboard changes a binding's keys through here, with conflict
 * detection and Reset. The keymap lives in the settings store (`settings.keymap`); S0's chips and
 * `aria-keyshortcuts` read it, so they follow every remap.
 */
import type { Platform } from "@lattice-studio/core";
import {
  getCommand, listBindings, settings, type BindingId, type KeySpec, type ResolvedBinding, type SettingsState,
} from "@/contracts";
import { keyLabel } from "@/ui/keys/key-labels";
import { chordOf, isSingleKey, sameKeys, specKeys } from "./key-spec";
import { contextsOf, reservedOn, reservedReason, type ReservedReason } from "./resolve";

/** Another binding already on one of the keys. */
export type KeyConflict = {
  /** The binding that has the keys now. */
  binding: ResolvedBinding;
  /** Its title as Settings shows it ("Undo", "Go to inspector"). */
  title: string;
  /** The keys both would share. */
  keys: KeySpec;
};

export type RemapResult =
  | { ok: true; text: string }
  | { ok: false; reason: string; conflicts: KeyConflict[] };

/** A binding's title: its label, else its command's title for the binding's arguments. */
export function bindingTitle(binding: ResolvedBinding): string {
  if (binding.label) return binding.label;
  try {
    return getCommand(binding.ref.id).title(binding.ref.args ?? {});
  } catch {
    return binding.ref.id;
  }
}

function findBinding(id: BindingId, keymap: SettingsState["keymap"]): ResolvedBinding | undefined {
  return listBindings(keymap).find((b) => b.id === id);
}

/** A spec as people read it on `platform`: ⌘Z, Ctrl+Y. */
function label(spec: KeySpec, platform: Platform): string {
  const keys = specKeys(spec, platform) ?? specKeys(spec, platform === "mac" ? "other" : "mac") ?? "";
  return keyLabel(keys, platform);
}

/** Whether two bindings can be live in the same place. */
function overlap(a: ResolvedBinding, b: ResolvedBinding): boolean {
  const theirs = contextsOf(b);
  return contextsOf(a).some((c) => theirs.includes(c));
}

/**
 * `"Shift+1"` names ⇧1 by the character it types; `"Shift+[Digit1]"` names it by physical key, and the
 * dispatcher always prefers a code-tier match (IR L1). A character spec shaped like Shift+digit could
 * therefore never fire where the code spec for the same digit is already live, so `findConflicts` treats them
 * as the same keypress too (FX13 item j).
 */
const SHIFT_DIGIT = /^Shift\+(\d)$/;

function codeShadow(spec: KeySpec): KeySpec | null {
  if (typeof spec !== "string") return null;
  const digit = SHIFT_DIGIT.exec(spec)?.[1];
  return digit === undefined ? null : `Shift+[Digit${digit}]`;
}

/**
 * Bindings other than `id` that `keys` would collide with: the same keypress on a platform both apply to, in
 * a key context both are live in. Region bindings (F6, Go to …) count too.
 */
export function findConflicts(
  id: BindingId,
  keys: readonly KeySpec[],
  keymap: SettingsState["keymap"] = settings.get().keymap,
): KeyConflict[] {
  const all = listBindings(keymap);
  const self = all.find((b) => b.id === id);
  if (!self) return [];
  const out: KeyConflict[] = [];
  for (const other of all) {
    if (other.id === id || !overlap(self, other)) continue;
    const shared = keys.find((k) => {
      const shadow = codeShadow(k);
      return other.keys.some((o) => sameKeys(k, o) || (shadow !== null && sameKeys(shadow, o)));
    });
    if (shared !== undefined) out.push({ binding: other, title: bindingTitle(other), keys: shared });
  }
  return out;
}

const RESERVED_TEXT: Record<ReservedReason, (keys: string) => string> = {
  zoom: (keys) => `${keys} stays browser zoom. Choose another key.`,
  find: (keys) => `${keys} stays browser find. Choose another key.`,
  address: (keys) => `${keys} stays the address bar. Choose another key.`,
  tab: () => "Tab moves between controls. Choose another key.",
  closeTab: (keys) => `${keys} closes the tab; the browser never delivers it to Studio. Choose another key.`,
  newTab: (keys) => `${keys} opens a new tab; the browser never delivers it to Studio. Choose another key.`,
  newWindow: (keys) => `${keys} opens a new window; the browser never delivers it to Studio. Choose another key.`,
  quit: (keys) => `${keys} quits the browser; it never reaches Studio. Choose another key.`,
  reload: (keys) => `${keys} would block the browser's reload. Choose another key.`,
  print: (keys) => `${keys} would block the browser's print. Choose another key.`,
};

/** Why `keys` can't be bound as they are, or null: invalid grammar, or kept for the browser or for Tab. */
function invalidReason(keys: readonly KeySpec[], platform: Platform): string | null {
  for (const spec of keys) {
    const valid = chordOf(spec, "mac") ?? chordOf(spec, "other");
    if (!valid) return `“${typeof spec === "string" ? spec : spec.keys}” isn't a key Studio can bind.`;
    const reserved = reservedReason(spec);
    if (reserved) return RESERVED_TEXT[reserved](label(spec, platform));
  }
  return null;
}

/**
 * `keys` as they'd be recorded on `platform`: a bare Ctrl chord that's kept for the browser only on the other
 * platform (⌃L, ⌃F, ⌃0 on macOS: IR L36, L38) is scoped to `platform`, so it's judged only where it would
 * ever fire (FX13 item a).
 */
function scopedForPlatform(keys: readonly KeySpec[], platform: Platform): KeySpec[] {
  const other: Platform = platform === "mac" ? "other" : "mac";
  return keys.map((spec) => {
    if (typeof spec !== "string") return spec;
    if (reservedOn(spec, platform) || !reservedOn(spec, other)) return spec;
    return { keys: spec, platform };
  });
}

/**
 * Whether `keys` can replace binding `id`'s keys: null when they can, else why not and what they'd collide
 * with. Settings shows the reason and offers to take the keys over (`remapBinding(…, { replace: true })`).
 */
export function checkRemap(
  id: BindingId,
  keys: readonly KeySpec[],
  options: { keymap?: SettingsState["keymap"]; platform: Platform },
): { reason: string; conflicts: KeyConflict[] } | null {
  const keymap = options.keymap ?? settings.get().keymap;
  if (!findBinding(id, keymap)) return { reason: `“${id}” isn't a shortcut.`, conflicts: [] };
  const scoped = scopedForPlatform(keys, options.platform);
  const invalid = invalidReason(scoped, options.platform);
  if (invalid) return { reason: invalid, conflicts: [] };
  const conflicts = findConflicts(id, scoped, keymap);
  const first = conflicts[0];
  if (!first) return null;
  return { reason: `${label(first.keys, options.platform)} is already used for ${first.title}. Replace it or choose another key.`, conflicts };
}

function sameList(a: readonly KeySpec[], b: readonly KeySpec[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function writeKeymap(next: SettingsState["keymap"]): void {
  settings.set({ keymap: next });
}

/**
 * Gives binding `id` the keys `keys` (an empty list unbinds it). Refuses keys the browser keeps and, unless
 * `replace`, keys another binding has; with `replace` the other bindings lose those keys. Keys equal to the
 * defaults clear the override. Says what it did.
 */
export function remapBinding(
  id: BindingId,
  keys: readonly KeySpec[],
  options: { replace?: boolean; platform: Platform },
): RemapResult {
  const keymap = settings.get().keymap;
  const scoped = scopedForPlatform(keys, options.platform);
  const problem = checkRemap(id, scoped, { keymap, platform: options.platform });
  if (problem && (!options.replace || problem.conflicts.length === 0)) return { ok: false, ...problem };
  const binding = findBinding(id, keymap);
  if (!binding) return { ok: false, reason: `“${id}” isn't a shortcut.`, conflicts: [] };
  const next: SettingsState["keymap"] = { ...keymap };
  const cleared: string[] = [];
  for (const conflict of problem?.conflicts ?? []) {
    const other = conflict.binding;
    const kept = other.keys.filter((k) => !scoped.some((mine) => sameKeys(mine, k)));
    if (sameList(kept, other.defaults)) delete next[other.id];
    else next[other.id] = kept;
    if (kept.length === 0) cleared.push(bindingTitle(other));
  }
  const unique = scoped.filter((k, i) => scoped.findIndex((o) => sameKeys(o, k)) === i);
  if (sameList(unique, binding.defaults)) delete next[id];
  else next[id] = unique;
  writeKeymap(next);
  const title = bindingTitle(binding);
  const lines = [
    unique.length
      ? `${title} is now ${unique.map((k) => label(k, options.platform)).join(" or ")}.`
      : `${title} has no shortcut now.`,
    ...cleared.map((t) => `${t} has no shortcut now.`),
  ];
  return { ok: true, text: lines.join(" ") };
}

/** Puts binding `id` back to its default keys, and says so for S10 to show. */
export function resetBinding(id: BindingId): string {
  const keymap = settings.get().keymap;
  const binding = findBinding(id, keymap);
  const title = binding ? bindingTitle(binding) : id;
  if (!(id in keymap)) return `${title} is already at its default.`;
  const next = { ...keymap };
  delete next[id];
  writeKeymap(next);
  return `${title} is back to its default.`;
}

/** Puts every binding back to its default keys, and says how many for S10 to show. */
export function resetKeymap(): string {
  const count = Object.keys(settings.get().keymap).length;
  writeKeymap({});
  if (count === 0) return "Every shortcut is already at its default.";
  return count === 1 ? "Reset 1 shortcut to its default." : `Reset ${count} shortcuts to their defaults.`;
}

/** Whether binding `id` has keys other than its defaults. */
export function isRemapped(id: BindingId, keymap: SettingsState["keymap"] = settings.get().keymap): boolean {
  return id in keymap;
}

/** Whether any of a binding's keys is a single-key shortcut (it follows the single-key rules). */
export function hasSingleKey(binding: Pick<ResolvedBinding, "keys">): boolean {
  return binding.keys.some(isSingleKey);
}
