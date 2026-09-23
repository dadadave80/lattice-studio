/**
 * The Keyboard shortcuts dialog's rows (IR L186): every binding with keys on this platform, grouped by
 * category, with its console syntax, filtered by the search. Pure over the bindings and commands passed in.
 */
import type { Platform } from "@lattice-studio/core";
import type { BindingId, Command, CommandCategory, KeySpec, ResolvedBinding } from "@/contracts";
import { keyLabel } from "@/ui/keys/key-labels";
import { isSingleKey, specKeys } from "./keys/key-spec";

export type ShortcutRow = {
  id: BindingId;
  title: string;
  category: CommandCategory;
  /** The keys that apply on this platform, as remapped. */
  keys: KeySpec[];
  /** The keys as people read them here: ⌘Z, Ctrl+Y. */
  labels: string[];
  /** Console syntax in grey (IR L165). */
  syntax?: string;
};

export type ShortcutGroup = { category: CommandCategory; rows: ShortcutRow[] };

/** The dialog's group order: the palette's (IR L162), then the rest as contracts §5.3 lists them. */
export const CATEGORY_ORDER: readonly CommandCategory[] = ["Sheet", "Build", "Session", "Export", "Deploy", "Console", "Chain"];

function titleOf(binding: ResolvedBinding, command: Command | undefined): string {
  if (binding.label) return binding.label;
  try {
    return command ? command.title(binding.ref.args ?? {}) : binding.ref.id;
  } catch {
    return binding.ref.id;
  }
}

/**
 * One row per binding with keys that apply on `platform`; single-key ones drop out while those are off
 * (as `ShortcutChip` hides them).
 */
export function shortcutRows(
  bindings: readonly ResolvedBinding[],
  commandOf: (b: ResolvedBinding) => Command | undefined,
  options: { platform: Platform; singleKeys: boolean },
): ShortcutRow[] {
  const rows: ShortcutRow[] = [];
  for (const binding of bindings) {
    const keys = binding.keys.filter((k) => specKeys(k, options.platform) !== null && (options.singleKeys || !isSingleKey(k)));
    if (!keys.length) continue;
    const command = commandOf(binding);
    if (!command) continue;
    const syntax = command.console?.syntax;
    rows.push({
      id: binding.id,
      title: titleOf(binding, command),
      category: command.category,
      keys,
      labels: keys.map((k) => keyLabel(specKeys(k, options.platform) ?? "", options.platform)),
      ...(syntax === undefined ? {} : { syntax }),
    });
  }
  return rows;
}

/** Whether `row` matches every word of `query` in its title, category, keys or console syntax. */
export function rowMatches(row: ShortcutRow, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const haystack = [row.title, row.category, ...row.labels, ...(row.keys.map((k) => (typeof k === "string" ? k : k.keys))), row.syntax ?? ""]
    .join(" ")
    .toLowerCase();
  return words.every((w) => haystack.includes(w));
}

/** The rows matching `query`, grouped in `CATEGORY_ORDER`, empty groups left out. */
export function groupRows(rows: readonly ShortcutRow[], query: string): ShortcutGroup[] {
  const shown = rows.filter((r) => rowMatches(r, query));
  return CATEGORY_ORDER.map((category) => ({ category, rows: shown.filter((r) => r.category === category) })).filter(
    (g) => g.rows.length > 0,
  );
}
