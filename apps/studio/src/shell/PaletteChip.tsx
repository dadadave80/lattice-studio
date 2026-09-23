import { commandRef } from "@/contracts";
import { CommandButton, cx, ShortcutChip, VisuallyHidden } from "@/ui";
import styles from "./TitleBar.module.css";

/** The ⌘K chip (IR L72): opens the command palette. It shows the keys; its name adds what they open. */
export function PaletteChip() {
  return (
    <CommandButton command={commandRef("palette.open")} size="small" className={cx(styles.palette)}>
      <ShortcutChip keys="Mod+k" />
      <VisuallyHidden> Command palette</VisuallyHidden>
    </CommandButton>
  );
}
