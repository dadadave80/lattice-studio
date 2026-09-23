import { ContextMenu as BaseContextMenu } from "@base-ui/react/context-menu";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactElement, type ReactNode } from "react";
import { KEY_CONTEXT_ATTRIBUTE } from "@/contracts";
import { isContextMenuKey } from "./context-menu-key";
import styles from "./Menu.module.css";

export type ContextMenuProps = {
  /**
   * The target: a card, a pin, the sheet, a tree row. It must spread the props it receives onto its element,
   * accept a ref and be focusable for the keyboard path. Its own key handlers keep working.
   */
  children: ReactElement;
  /** The same item components as `Menu`. */
  items: ReactNode;
  /** The menu's accessible name ("ERC20 actions"). */
  label: string;
  /** Controlled open state (optional). Right click, long press and the keyboard path still ask through `onOpenChange`. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * Where a programmatic open (`open` set true by the owner, not by a pointer or key on the target) places the
   * menu: below this element, with focus on the first item. Unset, it's placed below the target.
   */
  anchor?: Element | null;
  /**
   * No menu for now: a right click or long press reaches the browser (its own menu shows), Shift+F10 and the
   * Menu key pass through to the target, an open menu closes (asking an owner that controls `open` to close),
   * and an owner's `open` is ignored. The target keeps its element, so this can change while it has focus.
   */
  disabled?: boolean;
};

const ITEM_SELECTOR = '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]';

/**
 * How the menu was opened: at the pointer (right click, long press), or below an element with focus on the
 * first item (Shift+F10, the Menu key, or a programmatic open). Null while closed or for a programmatic open.
 */
type Origin = { kind: "pointer" } | { kind: "element"; element: Element } | null;

/**
 * A context menu (IR L189-L196). Right click or long press opens it at the pointer; Shift+F10 or the Menu key
 * on the focused target opens it below the target with focus on the first item (Chromium on macOS fires no
 * `contextmenu` for either). Esc closes it and returns focus to the target. It can also be controlled, and
 * opened from elsewhere below `anchor`.
 */
export function ContextMenu({
  children, items, label, open: openProp, onOpenChange, anchor, disabled = false,
}: ContextMenuProps) {
  const [innerOpen, setInnerOpen] = useState(false);
  const open = !disabled && (openProp ?? innerOpen);
  const [origin, setOrigin] = useState<Origin>(null);
  const [trigger, setTrigger] = useState<HTMLElement | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  // An owner that declined an open (a controlled `open` left false) leaves no popup to close, so nothing else
  // clears the origin; a stale one would misplace the next programmatic open.
  useEffect(() => {
    if (!open && origin !== null && !popupRef.current) setOrigin(null);
  }, [open, origin]);

  const setOpen = (next: boolean) => {
    if (openProp === undefined) setInnerOpen(next);
    onOpenChange?.(next);
  };

  // Disabling closes an open menu for good, so it can't reopen by itself when the menu is enabled again: its
  // own state resets here, and an owner that controls `open` is asked to close.
  if (disabled && innerOpen) setInnerOpen(false);
  useEffect(() => {
    if (disabled && openProp) onOpenChange?.(false);
  }, [disabled, openProp, onOpenChange]);

  /** The element the menu sits below, or null to sit at the pointer. */
  const anchorElement: Element | null =
    origin?.kind === "element" ? origin.element : origin === null ? (anchor ?? trigger) : null;

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (open || disabled || !isContextMenuKey(event)) return;
    event.preventDefault();
    setOrigin({ kind: "element", element: event.currentTarget });
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
      disabled={disabled}
      onOpenChange={(next) => {
        // Base UI asks to open only from a right click or a long press: those sit at the pointer.
        if (next) setOrigin({ kind: "pointer" });
        setOpen(next);
      }}
      onOpenChangeComplete={(isOpen) => {
        if (!isOpen) setOrigin(null);
        else if (anchorElement) focusFirstItem();
      }}
    >
      <BaseContextMenu.Trigger ref={setTrigger} render={children} onKeyDown={onKeyDown} />
      <BaseContextMenu.Portal>
        <BaseContextMenu.Positioner
          className={styles.positioner}
          collisionPadding={8}
          {...(anchorElement ? { anchor: anchorElement, side: "bottom" as const, align: "start" as const, sideOffset: 4 } : {})}
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
