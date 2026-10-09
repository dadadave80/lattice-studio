import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { useEffect, useRef, type FocusEvent, type ReactNode, type RefObject } from "react";
import { KEY_CONTEXT_ATTRIBUTE } from "@/contracts";
import { cx } from "../shared/cx";
import styles from "./Dialog.module.css";

export type DialogSize = "medium" | "wide";

export type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The visible heading; it labels the dialog. */
  title: string;
  /** A line under the title; it describes the dialog. */
  description?: ReactNode;
  /**
   * Where focus goes on open (IR L170-L185: "The review heading", "Cancel", "File name"). A ref or a function
   * returning the element; null falls back to the first focusable element. `"title"` focuses the dialog's own
   * heading (made focusable with tabIndex -1), for a dialog that is read before it's acted on (Deploy review).
   */
  initialFocus?: RefObject<HTMLElement | null> | (() => HTMLElement | null) | "title";
  /**
   * True when closing loses nothing: a click on the scrim then closes it too. Esc always closes (IR L187).
   */
  lossless?: boolean;
  /**
   * False for a dialog below another in the stack: it stays rendered but inert (no trap, not interactive,
   * hidden from assistive technology). When it becomes the top again, focus goes back where it was in it.
   */
  top?: boolean;
  /** `medium` (480 px, default) or `wide` (640 px, the deploy review). A bottom sheet under 768 px either way. */
  size?: DialogSize;
  /** The actions, right-aligned: the primary last. */
  footer?: ReactNode;
  children?: ReactNode;
  className?: string;
};

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

function firstFocusable(root: HTMLElement | null): HTMLElement | null {
  return root?.querySelector<HTMLElement>(FOCUSABLE) ?? null;
}

/**
 * A modal dialog (IR L170-L187). It traps Tab, closes on Esc, and returns focus to the element that was
 * focused when it opened (app dialogs open through `openDialog()`, so that's the control that opened them).
 * A click on the scrim closes it only when `lossless`. Declares the `dialog` key context.
 */
export function Dialog({
  open, onOpenChange, title, description, initialFocus, lossless = false, top = true, size = "medium", footer,
  children, className,
}: DialogProps) {
  const popupRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  /** The element focused before this dialog opened: where focus returns on close. */
  const openerRef = useRef<HTMLElement | null>(null);
  /** The last element focused inside the popup: where focus returns when a dialog above this one closes. */
  const lastFocusRef = useRef<HTMLElement | null>(null);
  const wasTopRef = useRef(top);

  useEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && !popupRef.current?.contains(active)) openerRef.current = active;
  }, [open]);

  useEffect(() => {
    const wasTop = wasTopRef.current;
    wasTopRef.current = top;
    if (!top || wasTop || !open) return;
    const popup = popupRef.current;
    if (!popup || popup.contains(document.activeElement)) return;
    const last = lastFocusRef.current;
    const target = last?.isConnected && popup.contains(last) ? last : (firstFocusable(popup) ?? popup);
    target.focus();
  }, [top, open]);

  const onFocusCapture = (event: FocusEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLElement) lastFocusRef.current = event.target;
  };

  const initial = (): HTMLElement | null | boolean => {
    if (!initialFocus) return null;
    if (initialFocus === "title") return titleRef.current;
    return typeof initialFocus === "function" ? initialFocus() : initialFocus.current;
  };

  const final = (): HTMLElement | null => {
    const opener = openerRef.current;
    return opener?.isConnected ? opener : null;
  };

  return (
    <BaseDialog.Root
      open={open}
      onOpenChange={(next) => {
        // A dialog under another ignores Esc and outside presses: they belong to the top one.
        if (!next && !top) return;
        onOpenChange(next);
      }}
      modal={top}
      disablePointerDismissal={!lossless || !top}
    >
      <BaseDialog.Portal>
        {top ? <BaseDialog.Backdrop className={styles.backdrop} data-dialog-backdrop="" /> : null}
        <BaseDialog.Viewport className={styles.viewport} inert={!top}>
          <BaseDialog.Popup
            ref={popupRef}
            className={cx(styles.popup, size === "wide" && styles.wide, className)}
            initialFocus={initial}
            finalFocus={final}
            onFocusCapture={onFocusCapture}
            {...{ [KEY_CONTEXT_ATTRIBUTE]: "dialog" }}
            {...(top ? {} : { "aria-hidden": true })}
          >
            <header className={styles.header}>
              <BaseDialog.Title
                ref={titleRef}
                className={styles.title}
                {...(initialFocus === "title" ? { tabIndex: -1 } : {})}
              >
                {title}
              </BaseDialog.Title>
              {description === undefined ? null : (
                <BaseDialog.Description className={styles.description}>{description}</BaseDialog.Description>
              )}
            </header>
            {children === undefined ? null : <div className={styles.body}>{children}</div>}
            {footer === undefined ? null : <footer className={styles.footer}>{footer}</footer>}
          </BaseDialog.Popup>
        </BaseDialog.Viewport>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}
