import type { KeyboardEvent, ReactNode } from "react";
import { platform } from "../shared/platform";
import styles from "../overlays/Menu.module.css";

/**
 * Base UI takes Enter with a modifier on a menu item as Enter and activates it. IR L13 makes Mod+Enter Deploy…
 * from anywhere but text fields and dialogs, so for that chord alone (⌘+Enter on macOS, Ctrl+Enter elsewhere,
 * no other modifier) the item skips its own handling and leaves the event alone: it bubbles to the shortcut
 * dispatcher on `window`. Any other modifier with Enter isn't a chord the dispatcher knows, so the item runs.
 */
export function passModEnter(event: KeyboardEvent & { preventBaseUIHandler: () => void }): void {
  if (event.key !== "Enter" || event.altKey || event.shiftKey) return;
  const mac = platform() === "mac";
  const mod = mac ? event.metaKey : event.ctrlKey;
  const other = mac ? event.ctrlKey : event.metaKey;
  if (mod && !other) event.preventBaseUIHandler();
}

type MenuRowProps = {
  id: string;
  label: string;
  /** Shown under the label while the item is disabled; the item's description. */
  reason?: string | null | undefined;
  /** Reserves the icon column, which the item itself draws. */
  slot?: boolean;
  /** The shortcut chip or the submenu chevron, at the row's end. */
  end?: ReactNode;
  /** The Base UI item. */
  children: ReactNode;
};

/**
 * One row of a menu. axe's `label-content-name-mismatch` (WCAG 2.5.3) compares an item's accessible name with
 * the text it shows on screen, and no ARIA attribute changes what it sees. So the label, the reason and the
 * shortcut are drawn beside the item, not inside it: the item is an empty layer over the row that takes the
 * pointer, the focus ring and the highlight, named by the label (`aria-labelledby`) and described by the
 * reason. The drawn text is hidden from assistive technology, which reaches it through those references.
 */
export function MenuRow({ id, label, reason, slot = false, end, children }: MenuRowProps) {
  return (
    <div className={styles.row} role="none">
      {children}
      <span className={styles.content} aria-hidden="true">
        {slot ? <span className={styles.slot} /> : null}
        <span className={styles.text}>
          <span id={`${id}-label`}>{label}</span>
          {reason ? (
            <span id={`${id}-reason`} className={styles.reason}>
              {reason}
            </span>
          ) : null}
        </span>
        {end}
      </span>
    </div>
  );
}
