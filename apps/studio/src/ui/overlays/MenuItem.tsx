import { Menu as BaseMenu } from "@base-ui/react/menu";
import { useId } from "react";
import type { KeySpec } from "@/contracts";
import { Icon } from "../icons/Icon";
import type { IconName } from "../icons/icon-paths";
import { ShortcutChip } from "../keys/ShortcutChip";
import { useAriaKeyShortcuts } from "../keys/use-aria-key-shortcuts";
import { cx } from "../shared/cx";
import styles from "./Menu.module.css";

export type MenuItemProps = {
  /** What the item does, in sentence case ("Move to…", "Flip pins"). */
  label: string;
  onSelect: () => void;
  /** Keys shown at the row's end and set as `aria-keyshortcuts`, per platform and the single-key setting. */
  shortcut?: KeySpec | readonly KeySpec[];
  icon?: IconName;
  /**
   * Why the item can't be used now ("Place facets first"). The item stays focusable and navigable, never
   * activates, and shows the reason under its label, which is also its accessible description.
   */
  disabledReason?: string | null | undefined;
  /** Keep the menu open after selecting (default false: it closes). */
  keepOpen?: boolean;
};

/** One action in a `Menu` or `ContextMenu`. */
export function MenuItem({ label, onSelect, shortcut, icon, disabledReason, keepOpen = false }: MenuItemProps) {
  const id = useId();
  const keyshortcuts = useAriaKeyShortcuts(shortcut);
  const labelId = `${id}-label`;
  const reasonId = `${id}-reason`;
  const disabled = Boolean(disabledReason);
  return (
    <BaseMenu.Item
      className={styles.item}
      label={label}
      disabled={disabled}
      closeOnClick={!keepOpen}
      onClick={() => {
        if (!disabled) onSelect();
      }}
      aria-labelledby={labelId}
      {...(disabled ? { "aria-describedby": reasonId } : {})}
      {...keyshortcuts}
    >
      {icon ? (
        <span className={styles.slot}>
          <Icon name={icon} />
        </span>
      ) : null}
      <span className={styles.text}>
        <span id={labelId}>{label}</span>
        {disabled ? (
          <span id={reasonId} className={styles.reason}>
            {disabledReason}
          </span>
        ) : null}
      </span>
      {shortcut === undefined ? null : <ShortcutChip keys={shortcut} className={cx(styles.shortcut)} />}
    </BaseMenu.Item>
  );
}
