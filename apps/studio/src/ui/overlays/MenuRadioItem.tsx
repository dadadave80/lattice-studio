import type { MenuRadioItemProps } from "../popups/MenuRadioItem";
import { usePopups } from "../popups/load";

export type { MenuRadioItemProps };

/** One value in a `MenuRadioGroup`: `ui/popups/MenuRadioItem.tsx`, drawn only in an open menu. */
export function MenuRadioItem(props: MenuRadioItemProps) {
  const popups = usePopups();
  return popups ? <popups.MenuRadioItem {...props} /> : null;
}
