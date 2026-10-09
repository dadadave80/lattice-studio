import type { TooltipProps, TooltipSide } from "../popups/Tooltip";
import { usePopups } from "../popups/load";

export type { TooltipProps, TooltipSide };

/**
 * A tooltip on hover and focus: `ui/popups/Tooltip.tsx`. Until the popups chunk loads (`ui/popups/load.ts`) it's
 * its trigger alone; the trigger already carries its own name, and `ReasonTooltip` its reason.
 */
export function Tooltip(props: TooltipProps) {
  const popups = usePopups();
  return popups ? <popups.Tooltip {...props} /> : props.children;
}
