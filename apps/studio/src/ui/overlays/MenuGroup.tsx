import type { MenuGroupProps } from "../popups/MenuGroup";
import { usePopups } from "../popups/load";

export type { MenuGroupProps };

/** A labelled run of menu items: `ui/popups/MenuGroup.tsx`, drawn only in an open menu. */
export function MenuGroup(props: MenuGroupProps) {
  const popups = usePopups();
  return popups ? <popups.MenuGroup {...props} /> : null;
}
