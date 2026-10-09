import type { MenuCheckboxItemProps } from "../popups/MenuCheckboxItem";
import { usePopups } from "../popups/load";

export type { MenuCheckboxItemProps };

/** A menu item that toggles: `ui/popups/MenuCheckboxItem.tsx`, drawn only in an open menu. */
export function MenuCheckboxItem(props: MenuCheckboxItemProps) {
  const popups = usePopups();
  return popups ? <popups.MenuCheckboxItem {...props} /> : null;
}
