import { Menu as BaseMenu } from "@base-ui/react/menu";
import { useId } from "react";
import { Icon } from "../icons/Icon";
import styles from "./Menu.module.css";
import { MenuRow, passModEnter } from "./menu-item-parts";

export type MenuCheckboxItemProps = {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Why it can't be changed now: the item stays navigable, never toggles, and shows the reason. */
  disabledReason?: string | null | undefined;
};

/** A menu item that turns something on or off ("Show minimap"). The menu stays open when it toggles. */
export function MenuCheckboxItem({ label, checked, onCheckedChange, disabledReason }: MenuCheckboxItemProps) {
  const id = useId();
  const disabled = Boolean(disabledReason);
  return (
    <MenuRow id={id} label={label} reason={disabledReason} slot>
      <BaseMenu.CheckboxItem
        className={styles.item}
        label={label}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(next) => {
          if (!disabled) onCheckedChange(next);
        }}
        aria-labelledby={`${id}-label`}
        onKeyDown={passModEnter}
        {...(disabled ? { "aria-describedby": `${id}-reason` } : {})}
      >
        <span className={styles.slot}>
          <BaseMenu.CheckboxItemIndicator>
            <Icon name="check" />
          </BaseMenu.CheckboxItemIndicator>
        </span>
      </BaseMenu.CheckboxItem>
    </MenuRow>
  );
}
