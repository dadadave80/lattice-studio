import { Menu as BaseMenu } from "@base-ui/react/menu";
import type { ReactElement, ReactNode } from "react";
import { KEY_CONTEXT_ATTRIBUTE } from "@/contracts";
import styles from "./Menu.module.css";

export type MenuProps = {
  /**
   * The control that opens the menu: a `<Button>` or `<IconButton>`. It must spread the props it receives onto
   * its element and accept a ref.
   */
  trigger: ReactElement;
  /** The menu's accessible name ("App menu", "Export"). */
  label: string;
  /** `MenuItem`, `MenuCommandItem`, `MenuGroup`, `MenuSeparator`, `MenuCheckboxItem`, `MenuRadioGroup`, `Submenu`. */
  children: ReactNode;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  /** Controlled open state (optional). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

/**
 * A menu button (WAI-ARIA APG). Enter, Space and ↓ open it on the first item, ↑ on the last; arrows, Home,
 * End and typing move through the items; Esc closes it and returns focus to the trigger. Declares the
 * `menu` key context, so single-key shortcuts stay inert inside it.
 */
export function Menu({ trigger, label, children, side = "bottom", align = "start", open, onOpenChange }: MenuProps) {
  return (
    <BaseMenu.Root
      {...(open === undefined ? {} : { open })}
      {...(onOpenChange ? { onOpenChange: (next: boolean) => onOpenChange(next) } : {})}
    >
      <BaseMenu.Trigger render={trigger} />
      <BaseMenu.Portal>
        <BaseMenu.Positioner className={styles.positioner} side={side} align={align} sideOffset={4} collisionPadding={8}>
          <BaseMenu.Popup
            className={styles.popup}
            aria-label={label}
            // Base UI names the popup after the active trigger by default (`aria-labelledby`), which wins over
            // `aria-label` in the accessible-name computation; clear it so `label` always names the menu.
            aria-labelledby={undefined}
            {...{ [KEY_CONTEXT_ATTRIBUTE]: "menu" }}
          >
            {children}
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  );
}
