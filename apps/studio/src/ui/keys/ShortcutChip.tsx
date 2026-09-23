import { listBindings, useSettings, type BindingId, type KeySpec } from "@/contracts";
import { cx } from "../shared/cx";
import { usePlatform } from "../shared/platform";
import styles from "./Kbd.module.css";
import { firstKeys, keyLabel } from "./key-labels";
import { liveSpecs } from "./use-aria-key-shortcuts";

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
  const shown = firstKeys(liveSpecs(specs, platform, singleKeys), platform);
  if (!shown) return null;
  return <kbd className={cx(styles.chip, className)}>{keyLabel(shown, platform)}</kbd>;
}
