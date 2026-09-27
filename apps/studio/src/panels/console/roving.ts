/**
 * Roving focus for a row of buttons (APG toolbar): the row is one Tab stop, the button last focused; ← → move
 * along it (wrapping), Home and End jump to the ends. The buttons come from shared components that don't take
 * `tabIndex`, so the hook sets it on the DOM after every render; a disabled-with-reason button stays in the row,
 * since it's focusable for its reason (spec L661).
 */
import { useLayoutEffect, useRef, type FocusEvent, type KeyboardEvent, type RefObject } from "react";

export type RovingHandlers<T extends HTMLElement> = {
  onKeyDown: (event: KeyboardEvent<T>) => void;
  onFocus: (event: FocusEvent<T>) => void;
};

function itemsOf(root: HTMLElement | null): HTMLElement[] {
  return root ? [...root.querySelectorAll<HTMLElement>("button")] : [];
}

/** Roves the buttons inside `row`: spread the handlers on the same element. */
export function useRovingFocus<T extends HTMLElement>(row: RefObject<T | null>): RovingHandlers<T> {
  const active = useRef(0);

  const apply = () => {
    const items = itemsOf(row.current);
    const at = Math.min(active.current, items.length - 1);
    items.forEach((item, i) => {
      item.tabIndex = i === at ? 0 : -1;
    });
  };

  // Every render: a re-rendered button may have been given its tabindex back.
  useLayoutEffect(apply);

  const onFocus = (event: FocusEvent<T>) => {
    const at = itemsOf(row.current).indexOf(event.target as HTMLElement);
    if (at < 0 || at === active.current) return;
    active.current = at;
    apply();
  };

  const onKeyDown = (event: KeyboardEvent<T>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const items = itemsOf(row.current);
    const from = items.indexOf(event.target as HTMLElement);
    if (from < 0) return;
    let to: number;
    if (event.key === "ArrowRight") to = (from + 1) % items.length;
    else if (event.key === "ArrowLeft") to = (from - 1 + items.length) % items.length;
    else if (event.key === "Home") to = 0;
    else if (event.key === "End") to = items.length - 1;
    else return;
    event.preventDefault();
    active.current = to;
    apply();
    items[to]?.focus();
  };

  return { onKeyDown, onFocus };
}
