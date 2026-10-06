import { cloneElement, useState, type MouseEvent, type ReactElement } from "react";
import type { MenuProps } from "../popups/Menu";
import { usePopups } from "../popups/load";

export type { MenuProps };

type TriggerProps = { onClick?: (event: MouseEvent<HTMLElement>) => void };

/**
 * A menu button (WAI-ARIA APG): `ui/popups/Menu.tsx`. Until the popups chunk loads (`ui/popups/load.ts`) it's its
 * trigger alone, and a press on it isn't lost: the menu opens as soon as the chunk arrives.
 */
export function Menu(props: MenuProps) {
  const popups = usePopups();
  const [own, setOwn] = useState(false);
  const open = props.open ?? own;
  const onOpenChange = (next: boolean) => {
    if (props.open === undefined) setOwn(next);
    props.onOpenChange?.(next);
  };
  if (popups) return <popups.Menu {...props} open={open} onOpenChange={onOpenChange} />;
  const trigger = props.trigger as ReactElement<TriggerProps>;
  return cloneElement(trigger, {
    onClick: (event: MouseEvent<HTMLElement>) => {
      trigger.props.onClick?.(event);
      onOpenChange(true);
    },
  });
}
