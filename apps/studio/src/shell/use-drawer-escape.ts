/**
 * Esc closes an open drawer (IR L14: the top overlay first). The drawer joins S2's escape stack while it's
 * open, and also handles Esc pressed inside it itself, stopping it there so the next layer (clearing the
 * selection) doesn't run as well. Where focus goes afterwards is `focus-return.ts`'s job.
 */
import { useEffect } from "react";
import { pushEscape, session } from "@/contracts";

export type DrawerSide = "left" | "inspector";

const DRAWER_IDS: Readonly<Record<DrawerSide, string>> = { left: "shell-left", inspector: "shell-inspector" };

/** Closes the open drawer. Returns false when none was open. */
export function closeDrawer(): boolean {
  if (session.get().panes.drawer === null) return false;
  session.set((s) => ({ panes: { ...s.panes, drawer: null } }));
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
