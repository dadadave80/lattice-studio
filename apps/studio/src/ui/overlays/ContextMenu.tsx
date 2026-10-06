import type { ContextMenuProps } from "../popups/ContextMenu";
import { usePopups } from "../popups/load";

export type { ContextMenuProps };

/** A context menu (IR L189-L196): `ui/popups/ContextMenu.tsx`. Until the popups chunk loads (`ui/popups/load.ts`) it's its target alone. */
export function ContextMenu(props: ContextMenuProps) {
  const popups = usePopups();
  return popups ? <popups.ContextMenu {...props} /> : props.children;
}
