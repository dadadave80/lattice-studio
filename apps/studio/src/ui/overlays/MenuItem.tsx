import type { MenuItemProps } from "../popups/MenuItem";
import { usePopups } from "../popups/load";

export type { MenuItemProps };

/** One action in a `Menu` or `ContextMenu`: `ui/popups/MenuItem.tsx`, drawn only in an open menu, so once the popups chunk has loaded. */
export function MenuItem(props: MenuItemProps) {
  const popups = usePopups();
  return popups ? <popups.MenuItem {...props} /> : null;
}
