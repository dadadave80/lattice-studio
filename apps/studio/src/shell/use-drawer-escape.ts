/**
 * Esc closes an open drawer (IR L14: the top overlay first). The drawer joins S2's escape stack while it's
 * open, and also handles Esc pressed inside it itself, stopping it there so the next layer (clearing the
 * selection) doesn't run as well. Closing a drawer that holds focus hands focus back to its title-bar toggle,
 * else to the sheet.
 */
import { useEffect } from "react";
import { pushEscape, session } from "@/contracts";
import { focusRegion } from "@/a11y";

export type DrawerSide = "left" | "inspector";

/**
 * The title bar's pane toggles sit in an element with this attribute ("catalog", "structure", "inspector"),
 * so focus can go back to the one that opened the drawer.
 */
export const DRAWER_TOGGLE_ATTRIBUTE = "data-drawer-toggle";

const DRAWER_IDS: Readonly<Record<DrawerSide, string>> = { left: "shell-left", inspector: "shell-inspector" };

/** Closes the open drawer. Returns false when none was open. */
export function closeDrawer(): boolean {
  const open = session.get().panes.drawer;
  if (open === null) return false;
  const drawer = document.getElementById(DRAWER_IDS[open]);
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
 * Esc pressed inside the drawer itself, heard on the document after the drawer's own controls had their say
 * (a search field clearing its query prevents the default, and the drawer stays). Keys from popups the drawer
 * opened (portaled menus) aren't inside it, so they close only the popup.
 */
function onKeyDown(event: KeyboardEvent): void {
  if (event.key !== "Escape" || event.defaultPrevented) return;
  const open = session.get().panes.drawer;
  const drawer = open === null ? null : document.getElementById(DRAWER_IDS[open]);
  if (!drawer || !(event.target instanceof Node) || !drawer.contains(event.target)) return;
  if (!closeDrawer()) return;
  event.preventDefault();
  event.stopPropagation();
}

/** While `open` names a drawer, Esc closes it. */
export function useDrawerEscape(open: DrawerSide | null): void {
  useEffect(() => {
    if (open === null) return;
    document.addEventListener("keydown", onKeyDown);
    const popEscape = pushEscape(() => closeDrawer());
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      popEscape();
    };
  }, [open]);
}
