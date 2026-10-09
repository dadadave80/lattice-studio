import { Menu as BaseMenu } from "@base-ui/react/menu";
import { useId } from "react";
import { Icon } from "../icons/Icon";
import styles from "../overlays/Menu.module.css";
import { MenuRow, passModEnter } from "./menu-item-parts";

export type MenuRadioItemProps = {
  value: string;
  label: string;
  /** Why it can't be chosen now: the item stays navigable, never selects, and shows the reason. */
  disabledReason?: string | null | undefined;
};

/** One option in a `MenuRadioGroup`. */
export function MenuRadioItem({ value, label, disabledReason }: MenuRadioItemProps) {
  const id = useId();
  const disabled = Boolean(disabledReason);
  return (
    <MenuRow id={id} label={label} reason={disabledReason} slot>
      <BaseMenu.RadioItem
        className={styles.item}
        value={value}
        label={label}
        disabled={disabled}
        aria-labelledby={`${id}-label`}
        onKeyDown={passModEnter}
        {...(disabled ? { "aria-describedby": `${id}-reason` } : {})}
      >
        <span className={styles.slot}>
          <BaseMenu.RadioItemIndicator>
            <Icon name="check" />
          </BaseMenu.RadioItemIndicator>
        </span>
      </BaseMenu.RadioItem>
    </MenuRow>
  );
}
