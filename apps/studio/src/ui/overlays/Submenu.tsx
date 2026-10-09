import type { SubmenuProps } from "../popups/Submenu";
import { usePopups } from "../popups/load";

export type { SubmenuProps };

/** A nested menu: `ui/popups/Submenu.tsx`, drawn only in an open menu. */
export function Submenu(props: SubmenuProps) {
  const popups = usePopups();
  return popups ? <popups.Submenu {...props} /> : null;
}
