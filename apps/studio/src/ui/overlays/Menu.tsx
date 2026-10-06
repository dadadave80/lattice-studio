import type { MenuProps } from "../popups/Menu";
import { usePopups } from "../popups/load";

export type { MenuProps };

/** A menu button (WAI-ARIA APG): `ui/popups/Menu.tsx`. Until the popups chunk loads (`ui/popups/load.ts`) it's its trigger alone. */
export function Menu(props: MenuProps) {
  const popups = usePopups();
  return popups ? <popups.Menu {...props} /> : props.trigger;
}
