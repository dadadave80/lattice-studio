import { Menu as BaseMenu } from "@base-ui/react/menu";
import { useId } from "react";
import { Icon } from "../icons/Icon";
import styles from "./Menu.module.css";

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
    <BaseMenu.RadioItem
      className={styles.item}
      value={value}
      label={label}
      disabled={disabled}
      aria-labelledby={`${id}-label`}
      {...(disabled ? { "aria-describedby": `${id}-reason` } : {})}
    >
      <span className={styles.slot}>
        <BaseMenu.RadioItemIndicator>
          <Icon name="check" />
        </BaseMenu.RadioItemIndicator>
      </span>
      <span className={styles.text}>
        <span id={`${id}-label`}>{label}</span>
        {disabled ? (
          <span id={`${id}-reason`} className={styles.reason}>
            {disabledReason}
          </span>
        ) : null}
      </span>
    </BaseMenu.RadioItem>
  );
}
