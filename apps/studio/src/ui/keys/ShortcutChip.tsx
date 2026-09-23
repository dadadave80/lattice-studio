import { listBindings, useSettings, type BindingId, type KeySpec } from "@/contracts";
import { cx } from "../shared/cx";
import { usePlatform } from "../shared/platform";
import styles from "./Kbd.module.css";
import { firstKeys, keyLabel, specKeys } from "./key-labels";

/**
 * A character-key shortcut (WCAG 2.1.4): a letter, digit, punctuation or symbol with no modifier other than
 * Shift. F-keys, Enter, Esc, Delete and arrows aren't; `Mod+k` isn't.
 */
export function isSingleKey(keys: string): boolean {
  const tokens = keys.endsWith("++") ? [...keys.slice(0, -2).split("+").filter(Boolean), "+"] : keys.split("+");
  const key = tokens.at(-1) ?? "";
  const modifiers = tokens.slice(0, -1);
  if (modifiers.some((m) => m !== "Shift")) return false;
  return key.length === 1 || /^\[(Digit|Key|Numpad)/.test(key);
}

export type ShortcutChipProps = {
  /** A command's binding (`"palette.open"`, `"region.focus#inspector"`): shows its keys as remapped in Settings. */
  binding?: BindingId;
  /** Or explicit keys. */
  keys?: KeySpec | readonly KeySpec[];
  className?: string;
};

/**
 * The shortcut for a command, per platform and as remapped (spec L660): what palette rows, menus and
 * tooltips show. Renders nothing when the binding has no keys here, or when it's a single-key shortcut and
 * single-key shortcuts are off.
 */
export function ShortcutChip({ binding, keys, className }: ShortcutChipProps) {
  const platform = usePlatform();
  const keymap = useSettings((s) => s.keymap);
  const singleKeys = useSettings((s) => s.singleKeys);
  let specs: readonly KeySpec[] | KeySpec | undefined = keys;
  if (binding !== undefined) specs = listBindings(keymap).find((b) => b.id === binding)?.keys;
  const list = specs === undefined ? [] : Array.isArray(specs) ? specs : [specs as KeySpec];
  const usable = list.filter((s) => {
    const k = specKeys(s, platform);
    return k !== null && (singleKeys || !isSingleKey(k));
  });
  const shown = firstKeys(usable, platform);
  if (!shown) return null;
  return <kbd className={cx(styles.chip, className)}>{keyLabel(shown, platform)}</kbd>;
}
