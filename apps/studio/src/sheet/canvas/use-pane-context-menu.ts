import { useEffect, type RefObject } from "react";

/** How far a right-button press may move and still be a click that opens the menu, not a drag that pans. */
export const RIGHT_CLICK_SLOP = 4;
/** How soon after a right drag's release its `contextmenu` arrives on Windows and Linux; a later one is a new request. */
const RELEASE_WINDOW_MS = 500;

export type PaneMenuHandler = (event: MouseEvent) => void;

function onPane(target: EventTarget | null): boolean {
  return target instanceof Element && target.classList.contains("react-flow__pane");
}

/**
 * Right-click on empty sheet opens its context menu (IR L46) while a right drag pans (IR L52). React Flow can't
 * do both: with right drag panning (`panOnDrag` including 2) its pane swallows every `contextmenu`. So the sheet
 * listens itself and calls `handler` for a right click that didn't move, whichever order the platform sends the
 * events in: macOS fires `contextmenu` with the press (held until the release shows it wasn't a drag), Windows
 * and Linux after the release. A `contextmenu` with no right press before it (the menu key, Shift+F10, a long
 * press) opens the menu at once. Only events on the pane itself count: cards, notes and panels have their own.
 */
export function usePaneContextMenu(wrapper: RefObject<HTMLElement | null>, handler: RefObject<PaneMenuHandler | undefined>): void {
  useEffect(() => {
    const el = wrapper.current;
    if (!el) return undefined;
    let press: { x: number; y: number; moved: boolean; pending: MouseEvent | null } | null = null;
    let released: { moved: boolean; at: number } | null = null;
    const forward = (event: MouseEvent) => handler.current?.(event);

    const down = (event: PointerEvent) => {
      if (event.button !== 2 || event.pointerType === "touch") return;
      press = { x: event.clientX, y: event.clientY, moved: false, pending: null };
      released = null;
    };
    const move = (event: PointerEvent) => {
      if (press && !press.moved && Math.hypot(event.clientX - press.x, event.clientY - press.y) > RIGHT_CLICK_SLOP) {
        press.moved = true;
      }
    };
    const up = (event: PointerEvent) => {
      if (!press || event.button !== 2) return;
      const { moved, pending } = press;
      press = null;
      if (pending) {
        if (!moved) forward(pending);
      } else {
        released = { moved, at: event.timeStamp };
      }
    };
    const cancel = () => {
      press = null;
      released = null;
    };
    const menu = (event: MouseEvent) => {
      if (!onPane(event.target)) return;
      event.preventDefault();
      if (press) {
        press.pending = event;
        return;
      }
      const after = released;
      released = null;
      if (after?.moved && event.timeStamp - after.at < RELEASE_WINDOW_MS) return;
      forward(event);
    };

    el.addEventListener("pointerdown", down, true);
    el.addEventListener("contextmenu", menu);
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
    window.addEventListener("pointercancel", cancel, true);
    return () => {
      el.removeEventListener("pointerdown", down, true);
      el.removeEventListener("contextmenu", menu);
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      window.removeEventListener("pointercancel", cancel, true);
    };
  }, [wrapper, handler]);
}
