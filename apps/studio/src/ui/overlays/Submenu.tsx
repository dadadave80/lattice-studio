import { Menu as BaseMenu } from "@base-ui/react/menu";
import { useId, type ReactNode } from "react";
import { KEY_CONTEXT_ATTRIBUTE } from "@/contracts";
import { Icon } from "../icons/Icon";
import styles from "./Menu.module.css";

export type SubmenuProps = {
  /** The item that opens the submenu ("Move to…"); also the submenu's accessible name. */
  label: string;
  /** Why it can't open now: the item stays navigable and shows the reason. */
  disabledReason?: string | null | undefined;
  children: ReactNode;
};

/** A nested menu. → or Enter opens it on its first item; ← or Esc closes it and returns to its item. */
export function Submenu({ label, disabledReason, children }: SubmenuProps) {
  const id = useId();
  const disabled = Boolean(disabledReason);
  return (
    <BaseMenu.SubmenuRoot disabled={disabled}>
      <BaseMenu.SubmenuTrigger
        className={styles.item}
        label={label}
        disabled={disabled}
        aria-labelledby={`${id}-label`}
        {...(disabled ? { "aria-describedby": `${id}-reason` } : {})}
      >
        <span className={styles.text}>
          <span id={`${id}-label`}>{label}</span>
          {disabled ? (
            <span id={`${id}-reason`} className={styles.reason}>
              {disabledReason}
            </span>
          ) : null}
        </span>
        <Icon name="chevron-right" className={styles.chevron} />
      </BaseMenu.SubmenuTrigger>
      <BaseMenu.Portal>
        <BaseMenu.Positioner className={styles.positioner} sideOffset={0} alignOffset={-4} collisionPadding={8}>
          <BaseMenu.Popup className={styles.popup} aria-label={label} {...{ [KEY_CONTEXT_ATTRIBUTE]: "menu" }}>
            {children}
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.SubmenuRoot>
  );
}
