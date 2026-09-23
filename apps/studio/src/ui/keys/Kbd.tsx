import type { KeySpec } from "@/contracts";
import { cx } from "../shared/cx";
import { usePlatform } from "../shared/platform";
import styles from "./Kbd.module.css";
import { firstKeys, keyLabel } from "./key-labels";

export type KbdProps = {
  /** A shortcut, or several (the first that applies on this platform shows). */
  keys: KeySpec | readonly KeySpec[];
  className?: string;
};

/** Keys as text, per platform: `<Kbd keys="Mod+k" />` reads ⌘K on macOS and Ctrl+K elsewhere. */
export function Kbd({ keys, className }: KbdProps) {
  const platform = usePlatform();
  const shown = firstKeys(keys, platform);
  if (!shown) return null;
  return <kbd className={cx(styles.kbd, className)}>{keyLabel(shown, platform)}</kbd>;
}
