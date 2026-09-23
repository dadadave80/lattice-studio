/**
 * Esc closes an open drawer (IR L14: the top overlay first). The drawer joins S2's escape stack while it's
 * open; closing it while it holds focus hands focus back to its title-bar toggle, else to the sheet.
 */
import { useEffect, type KeyboardEvent } from "react";
import { pushEscape, session } from "@/contracts";
import { focusRegion } from "@/a11y";

export type DrawerSide = "left" | "inspector";

/**
 * The title bar's pane toggles sit in an element with this attribute ("catalog", "structure", "inspector"),
 * so focus can go back to the one that opened the drawer.
 */
export const DRAWER_TOGGLE_ATTRIBUTE = "data-drawer-toggle";

/** Closes the open drawer. Returns false when none was open. */
export function closeDrawer(): boolean {
  const open = session.get().panes.drawer;
  if (open === null) return false;
  const drawer = document.getElementById(open === "left" ? "shell-left" : "shell-inspector");
  const hadFocus = drawer !== null && drawer.contains(document.activeElement);
  const toggleFor = open === "left" ? session.get().panes.left.tab : "inspector";
  session.set((s) => ({ panes: { ...s.panes, drawer: null } }));
  if (hadFocus) {
    const toggle = document.querySelector<HTMLElement>(`[${DRAWER_TOGGLE_ATTRIBUTE}="${toggleFor}"] button`);
    if (toggle) toggle.focus();
    else focusRegion("sheet");
  }
  return true;
}

/**
 * Esc pressed inside an open drawer closes it. The drawer handles it itself (the escape stack may not be
 * listening) and stops it there, so the next layer (clearing the selection) doesn't run too. Keys from
 * portaled popups (a menu opened from the drawer) close only the popup.
 */
export function onDrawerKeyDown(event: KeyboardEvent<HTMLElement>): void {
  if (event.key !== "Escape" || event.defaultPrevented) return;
  if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return;
  if (!closeDrawer()) return;
  event.preventDefault();
  event.stopPropagation();
}

/** While `open` names a drawer, Esc closes it. */
export function useDrawerEscape(open: DrawerSide | null): void {
  useEffect(() => {
    if (open === null) return;
    return pushEscape(() => closeDrawer());
  }, [open]);
}
