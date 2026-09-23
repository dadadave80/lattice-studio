import { ContextMenu as BaseContextMenu } from "@base-ui/react/context-menu";
import { useRef, useState, type KeyboardEvent, type ReactElement, type ReactNode } from "react";
import { KEY_CONTEXT_ATTRIBUTE } from "@/contracts";
import { isContextMenuKey } from "./context-menu-key";
import styles from "./Menu.module.css";

export type ContextMenuProps = {
  /**
   * The target: a card, a pin, the sheet. It must spread the props it receives onto its element, accept a ref
   * and be focusable for the keyboard path. Its own key handlers keep working.
   */
  children: ReactElement;
  /** The same item components as `Menu`. */
  items: ReactNode;
  /** The menu's accessible name ("ERC20 actions"). */
  label: string;
};

const ITEM_SELECTOR = '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]';

/**
 * A context menu (IR L189-L196). Right click or long press opens it at the pointer; Shift+F10 or the Menu key
 * on the focused target opens it below the target with focus on the first item (Chromium on macOS fires no
 * `contextmenu` for either). Esc closes it and returns focus to the target.
 */
export function ContextMenu({ children, items, label }: ContextMenuProps) {
  const [open, setOpen] = useState(false);
  /** The target, while the menu was opened from the keyboard; null for a pointer open (anchored at the pointer). */
  const [keyboardAnchor, setKeyboardAnchor] = useState<HTMLElement | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (open || !isContextMenuKey(event)) return;
    event.preventDefault();
    setKeyboardAnchor(event.currentTarget);
    setOpen(true);
  };

  const focusFirstItem = () => {
    const popup = popupRef.current;
    if (!popup) return;
    const all = [...popup.querySelectorAll<HTMLElement>(ITEM_SELECTOR)];
    const first = all.find((el) => el.getAttribute("aria-disabled") !== "true") ?? all[0];
    first?.focus();
  };

  return (
    <BaseContextMenu.Root
      open={open}
      onOpenChange={(next) => {
        if (next) setKeyboardAnchor(null);
        setOpen(next);
      }}
      onOpenChangeComplete={(isOpen) => {
        if (isOpen && keyboardAnchor) focusFirstItem();
      }}
    >
      <BaseContextMenu.Trigger render={children} onKeyDown={onKeyDown} />
      <BaseContextMenu.Portal>
        <BaseContextMenu.Positioner
          className={styles.positioner}
          collisionPadding={8}
          {...(keyboardAnchor ? { anchor: keyboardAnchor, side: "bottom" as const, align: "start" as const, sideOffset: 4 } : {})}
        >
          <BaseContextMenu.Popup
            ref={popupRef}
            className={styles.popup}
            aria-label={label}
            {...{ [KEY_CONTEXT_ATTRIBUTE]: "menu" }}
          >
            {items}
          </BaseContextMenu.Popup>
        </BaseContextMenu.Positioner>
      </BaseContextMenu.Portal>
    </BaseContextMenu.Root>
  );
}
