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
import { contextsOf, reservedReason } from "./resolve";

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
    const shared = keys.find((k) => other.keys.some((o) => sameKeys(k, o)));
    if (shared !== undefined) out.push({ binding: other, title: bindingTitle(other), keys: shared });
  }
  return out;
}

const RESERVED_TEXT = {
  zoom: (keys: string) => `${keys} stays browser zoom.`,
  find: (keys: string) => `${keys} stays browser find.`,
  address: (keys: string) => `${keys} stays the address bar.`,
  tab: () => "Tab moves between controls.",
} as const;

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
  const invalid = invalidReason(keys, options.platform);
  if (invalid) return { reason: invalid, conflicts: [] };
  const conflicts = findConflicts(id, keys, keymap);
  const first = conflicts[0];
  if (!first) return null;
  return { reason: `${label(first.keys, options.platform)} is already used for ${first.title}.`, conflicts };
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
  const problem = checkRemap(id, keys, { keymap, platform: options.platform });
  if (problem && (!options.replace || problem.conflicts.length === 0)) return { ok: false, ...problem };
  const binding = findBinding(id, keymap);
  if (!binding) return { ok: false, reason: `“${id}” isn't a shortcut.`, conflicts: [] };
  const next: SettingsState["keymap"] = { ...keymap };
  for (const conflict of problem?.conflicts ?? []) {
    const other = conflict.binding;
    const kept = other.keys.filter((k) => !keys.some((mine) => sameKeys(mine, k)));
    if (sameList(kept, other.defaults)) delete next[other.id];
    else next[other.id] = kept;
  }
  const unique = keys.filter((k, i) => keys.findIndex((o) => sameKeys(o, k)) === i);
  if (sameList(unique, binding.defaults)) delete next[id];
  else next[id] = unique;
  writeKeymap(next);
  const title = bindingTitle(binding);
  const text = unique.length
    ? `${title} is now ${unique.map((k) => label(k, options.platform)).join(" or ")}.`
    : `${title} has no shortcut now.`;
  return { ok: true, text };
}

/** Puts binding `id` back to its default keys. */
export function resetBinding(id: BindingId): void {
  const keymap = settings.get().keymap;
  if (!(id in keymap)) return;
  const next = { ...keymap };
  delete next[id];
  writeKeymap(next);
}

/** Puts every binding back to its default keys. */
export function resetKeymap(): void {
  writeKeymap({});
}

/** Whether binding `id` has keys other than its defaults. */
export function isRemapped(id: BindingId, keymap: SettingsState["keymap"] = settings.get().keymap): boolean {
  return id in keymap;
}

/** Whether any of a binding's keys is a single-key shortcut (it follows the single-key rules). */
export function hasSingleKey(binding: Pick<ResolvedBinding, "keys">): boolean {
  return binding.keys.some(isSingleKey);
}
