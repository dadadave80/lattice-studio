import type { MenuRadioGroupProps } from "../popups/MenuRadioGroup";
import { usePopups } from "../popups/load";

export type { MenuRadioGroupProps };

/** A group of menu items that pick one value: `ui/popups/MenuRadioGroup.tsx`, drawn only in an open menu. */
export function MenuRadioGroup(props: MenuRadioGroupProps) {
  const popups = usePopups();
  return popups ? <popups.MenuRadioGroup {...props} /> : null;
}
