import { cloneElement, useId, useState, type MouseEvent, type ReactElement, type ReactNode } from "react";
import type { KeySpec } from "@/contracts";
import { VisuallyHidden } from "../shared/VisuallyHidden";
import { Tooltip, type TooltipSide } from "./Tooltip";

type TriggerProps = {
  "aria-disabled"?: boolean | "true" | "false";
  "aria-describedby"?: string;
  onClickCapture?: (event: MouseEvent<HTMLElement>) => void;
};

export type ReasonTooltipProps = {
  /**
   * Why the control can't be used now, and what fixes it: "Resolve 2 blockers · F8" (spec L661). Null or
   * empty means enabled: the control works and only `content` (if any) shows as a tooltip.
   */
  reason: string | null | undefined;
  /** The tooltip's first line when there is one: an icon button's name, what a click does. */
  content?: ReactNode;
  shortcut?: KeySpec | readonly KeySpec[] | undefined;
  /** The control. It must spread the props it receives onto its element and accept a ref. */
  children: ReactElement<TriggerProps>;
  side?: TooltipSide;
};

/**
 * The disabled-control pattern (spec L661, contracts §5.3). While `reason` is set the control:
 * - stays focusable, with `aria-disabled="true"` instead of `disabled`;
 * - is described by the reason (`aria-describedby`), so keyboard and screen-reader users get it;
 * - shows the reason in a tooltip on hover and focus, and when clicked or tapped;
 * - never activates: clicks, Enter and Space are stopped before the control's own handlers run.
 */
export function ReasonTooltip({ reason, content, shortcut, children, side }: ReasonTooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const common = { shortcut, ...(side ? { side } : {}) };
  if (!reason) {
    if (content === undefined) return children;
    return (
      <Tooltip content={content} {...common}>
        {children}
      </Tooltip>
    );
  }
  const describedBy = [children.props["aria-describedby"], id].filter(Boolean).join(" ");
  const trigger = cloneElement(children, {
    "aria-disabled": true,
    "aria-describedby": describedBy,
    onClickCapture: (event: MouseEvent<HTMLElement>) => {
      event.preventDefault();
      event.stopPropagation();
      setOpen(true);
    },
  });
  return (
    <>
      <Tooltip
        content={content ?? reason}
        reason={content === undefined ? null : reason}
        open={open}
        onOpenChange={setOpen}
        closeOnClick={false}
        {...common}
      >
        {trigger}
      </Tooltip>
      <VisuallyHidden id={id}>{reason}</VisuallyHidden>
    </>
  );
}
