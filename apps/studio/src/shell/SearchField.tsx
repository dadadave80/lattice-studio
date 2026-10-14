import { commandRef, listBindings, useSettings } from "@/contracts";
import { CommandButton } from "@/ui/buttons/CommandButton";
import { firstKeys, keyCaps } from "@/ui/keys/key-labels";
import { liveSpecs } from "@/ui/keys/use-aria-key-shortcuts";
import { cx } from "@/ui/shared/cx";
import { usePlatform } from "@/ui/shared/platform";
import { VisuallyHidden } from "@/ui/shared/VisuallyHidden";
import styles from "./TitleBar.module.css";

/**
 * The search field (IR L72): opens the command palette. A search icon, "Search", and the palette's shortcut as
 * keycaps, as remapped in Settings. `compact` (under 1024 px) shows the icon alone. Either way the name is
 * "Search" and the shortcut ("Search ⌘K"), written once, out of sight, so the caps aren't read key by key; the
 * tooltip says "Search" and the shortcut too.
 */
export function SearchField({ compact = false }: { compact?: boolean }) {
  const platform = usePlatform();
  const keymap = useSettings((s) => s.keymap);
  const singleKeys = useSettings((s) => s.singleKeys);
  const specs = listBindings(keymap).find((b) => b.id === "palette.open")?.keys;
  const keys = firstKeys(liveSpecs(specs, platform, singleKeys), platform);
  const caps = keys ? keyCaps(keys, platform) : [];
  // The caps joined as keyLabel writes them (⌘K, Ctrl+K), from the caps so the + key survives.
  const name = caps.length ? `Search ${caps.join(platform === "mac" ? "" : "+")}` : "Search";
  return (
    <CommandButton
      command={commandRef("palette.open")}
      icon="search"
      variant={compact ? "quiet" : "secondary"}
      tooltip="Search"
      className={cx(styles.search, compact && styles.compact)}
    >
      <span aria-hidden="true" className={styles.searchLabel}>
        Search
      </span>
      {caps.length ? (
        <span aria-hidden="true" className={styles.keycaps}>
          {caps.map((cap, i) => (
            <kbd key={i} className={styles.keycap}>
              {cap}
            </kbd>
          ))}
        </span>
      ) : null}
      <VisuallyHidden>{name}</VisuallyHidden>
    </CommandButton>
  );
}
