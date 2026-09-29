import { Menu as BaseMenu } from "@base-ui/react/menu";
import { useId } from "react";
import type { KeySpec } from "@/contracts";
import { Icon } from "../icons/Icon";
import type { IconName } from "../icons/icon-paths";
import { ShortcutChip } from "../keys/ShortcutChip";
import { useAriaKeyShortcuts } from "../keys/use-aria-key-shortcuts";
import { cx } from "../shared/cx";
import styles from "./Menu.module.css";
import { MenuRow, passModEnter } from "./menu-item-parts";

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
  const disabled = Boolean(disabledReason);
  const chip = shortcut === undefined ? null : <ShortcutChip keys={shortcut} className={cx(styles.shortcut)} />;
  return (
    <MenuRow id={id} label={label} reason={disabledReason} slot={Boolean(icon)} end={chip}>
      <BaseMenu.Item
        className={styles.item}
        label={label}
        disabled={disabled}
        closeOnClick={!keepOpen}
        onClick={() => {
          if (!disabled) onSelect();
        }}
        aria-labelledby={`${id}-label`}
        onKeyDown={passModEnter}
        {...(disabled ? { "aria-describedby": `${id}-reason` } : {})}
        {...keyshortcuts}
      >
        {icon ? (
          <span className={styles.slot}>
            <Icon name={icon} />
          </span>
        ) : null}
      </BaseMenu.Item>
    </MenuRow>
  );
}
