import { usePopups } from "../popups/load";

/** A hairline between groups of menu items: `ui/popups/MenuSeparator.tsx`, drawn only in an open menu. */
export function MenuSeparator() {
  const popups = usePopups();
  return popups ? <popups.MenuSeparator /> : null;
}
