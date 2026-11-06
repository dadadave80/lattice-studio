import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import type { TooltipProps, TooltipSide } from "../popups/Tooltip";
import { usePopups } from "../popups/load";

export type { TooltipProps, TooltipSide };

/** The trigger keeps its element while the tooltip's popup contents load. */
export function Tooltip(props: TooltipProps) {
  const popups = usePopups();
  const { open, onOpenChange, disabled = false, closeOnClick = true, delay } = props;
  const control = open === undefined ? {} : { open };
  const handler = onOpenChange ? { onOpenChange: (next: boolean) => onOpenChange(next) } : {};
  return (
    <BaseTooltip.Root {...control} {...handler} disabled={disabled}>
      <BaseTooltip.Trigger render={props.children} closeOnClick={closeOnClick} {...(delay === undefined ? {} : { delay })} />
      {popups ? <popups.Tooltip {...props} /> : null}
    </BaseTooltip.Root>
  );
}
