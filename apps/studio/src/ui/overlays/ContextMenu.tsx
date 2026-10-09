import { cloneElement, useState, type KeyboardEvent, type MouseEvent, type ReactElement } from "react";
import type { ContextMenuProps } from "../popups/ContextMenu";
import { usePopups } from "../popups/load";
import { isContextMenuKey } from "./context-menu-key";

export type { ContextMenuProps };

type TargetProps = {
  onContextMenu?: (event: MouseEvent<HTMLElement>) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLElement>) => void;
};

/**
 * A context menu (IR L189-L196): `ui/popups/ContextMenu.tsx`. Until the popups chunk loads (`ui/popups/load.ts`)
 * it's its target alone, and a right click, Shift+F10 or the Menu key on it isn't lost: the menu opens below the
 * target as soon as the chunk arrives, as an owner's programmatic open does.
 */
export function ContextMenu(props: ContextMenuProps) {
  const popups = usePopups();
  const [early, setEarly] = useState(false);
  if (popups) {
    if (!early) return <popups.ContextMenu {...props} />;
    const onOpenChange = (next: boolean) => {
      if (!next) setEarly(false);
      props.onOpenChange?.(next);
    };
    return <popups.ContextMenu {...props} open={props.open ?? true} onOpenChange={onOpenChange} />;
  }
  const ask = (event: { preventDefault(): void }) => {
    if (props.disabled) return;
    event.preventDefault();
    if (props.open === undefined) setEarly(true);
    props.onOpenChange?.(true);
  };
  const target = props.children as ReactElement<TargetProps>;
  return cloneElement(target, {
    onContextMenu: (event: MouseEvent<HTMLElement>) => {
      target.props.onContextMenu?.(event);
      ask(event);
    },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      target.props.onKeyDown?.(event);
      if (isContextMenuKey(event)) ask(event);
    },
  });
}
