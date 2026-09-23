import { Autocomplete } from "@base-ui/react/autocomplete";
import { memo } from "react";
import { useCommandState } from "@/contracts";
import { ShortcutChip } from "@/ui";
import type { PaletteItem } from "./palette-items";
import styles from "./Palette.module.css";

export type PaletteRowProps = {
  item: PaletteItem;
  /** Runs the row: the palette closes first, then the command runs; a disabled row says why and stays. */
  onActivate: (item: PaletteItem, enabled: boolean) => void;
};

/**
 * One palette row (IR L165-L166): title, category, shortcut chip and console syntax in grey. A disabled row
 * stays, in faint ink with its reason ("Deploy… · resolve 2 blockers"), and uses `aria-disabled` so it stays
 * reachable and its reason is read (spec L661).
 */
export const PaletteRow = memo(function PaletteRow({ item, onActivate }: PaletteRowProps) {
  const state = useCommandState(item.ref, "palette");
  const reason = state.ok ? null : state.reason;
  return (
    <Autocomplete.Item
      value={item}
      className={styles.item}
      aria-disabled={reason === null ? undefined : true}
      onClick={() => onActivate(item, reason === null)}
    >
      <span className={styles.main}>
        <span className={styles.title}>{state.title}</span>
        {item.note ? <span className={styles.note}> · {item.note}</span> : null}
        {reason === null ? null : <span className={styles.reason}> · {reason}</span>}
      </span>
      <span className={styles.meta}>
        <span className={styles.category}>{item.category}</span>
        {item.binding ? <ShortcutChip binding={item.binding} /> : null}
        {item.syntax ? <code className={styles.syntax}>{item.syntax}</code> : null}
      </span>
    </Autocomplete.Item>
  );
});
