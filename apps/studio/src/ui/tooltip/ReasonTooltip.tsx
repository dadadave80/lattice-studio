import {
  cloneElement, useId, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactElement, type ReactNode,
} from "react";
import type { KeySpec } from "@/contracts";
import { Tooltip, type TooltipSide } from "./Tooltip";

type TriggerProps = {
  "aria-disabled"?: boolean | "true" | "false";
  "aria-describedby"?: string;
  children?: ReactNode;
  onClickCapture?: (event: MouseEvent<HTMLElement>) => void;
  onPointerDownCapture?: (event: PointerEvent<HTMLElement>) => void;
  onMouseDownCapture?: (event: MouseEvent<HTMLElement>) => void;
  onKeyDownCapture?: (event: KeyboardEvent<HTMLElement>) => void;
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
  /**
   * The control: an element that renders its children (a button, a menu trigger), spreads the props it
   * receives onto its element and accepts a ref. Void elements (`<input>`) can't hold the reason; wrap them.
   */
  children: ReactElement<TriggerProps>;
  side?: TooltipSide;
};

/** Keys that activate or open a control: blocked while it's disabled. Tab, Esc and the rest pass. */
const ACTIVATING = new Set(["Enter", " ", "ArrowDown", "ArrowUp"]);

/**
 * The disabled-control pattern (spec L661, contracts §5.3). While `reason` is set the control:
 * - stays focusable, with `aria-disabled="true"` instead of `disabled`;
 * - is described by the reason (`aria-describedby` to a `hidden` span inside it, so the control stays one
 *   element and can itself be a Menu, Popover or Tooltip trigger);
 * - shows the reason in a tooltip on hover and focus, and when clicked or tapped;
 * - never activates or opens anything: pointer presses, clicks, Enter, Space and ↑/↓ are stopped before the
 *   control's own handlers (and Base UI's menu and popover triggers) see them.
 *
 * The element tree is the same with or without a reason (the tooltip stays mounted, disabled when it has
 * nothing to show), so a control whose reason comes or goes keeps its element and its focus (spec L753).
 */
export function ReasonTooltip({ reason, content, shortcut, children, side }: ReasonTooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const hasReason = Boolean(reason);
  const block = (event: { preventDefault(): void; stopPropagation(): void }) => {
    event.preventDefault();
    event.stopPropagation();
  };
  // Only a reason adds props: an enabled control keeps its own `aria-*` and handlers untouched.
  const blocked = hasReason
    ? {
        "aria-disabled": true,
        "aria-describedby": [children.props["aria-describedby"], id].filter(Boolean).join(" "),
        // Focus still moves to the control (so the reason shows), but no press reaches a menu or popover trigger.
        onPointerDownCapture: (event: PointerEvent<HTMLElement>) => event.stopPropagation(),
        onMouseDownCapture: (event: MouseEvent<HTMLElement>) => event.stopPropagation(),
        onClickCapture: (event: MouseEvent<HTMLElement>) => {
          block(event);
          setOpen(true);
        },
        onKeyDownCapture: (event: KeyboardEvent<HTMLElement>) => {
          // ↑/↓ open a menu from its trigger; elsewhere they're a toolbar's or list's navigation, so they pass.
          const opensPopup = event.currentTarget.hasAttribute("aria-haspopup");
          if (event.key === "Enter" || event.key === " " || (opensPopup && ACTIVATING.has(event.key))) {
            block(event);
            setOpen(true);
          }
        },
      }
    : {};
  // The control's children always sit beside one slot for the hidden reason, so they keep their places too.
  const trigger = cloneElement(
    children,
    blocked,
    children.props.children,
    hasReason ? (
      <span key="lx-reason" id={id} hidden>
        {reason}
      </span>
    ) : null,
  );
  return (
    <Tooltip
      content={content ?? reason}
      reason={content === undefined ? null : reason}
      // Controlled either way, so the tooltip never switches between controlled and uncontrolled.
      open={open}
      onOpenChange={setOpen}
      closeOnClick={!hasReason}
      disabled={!hasReason && content === undefined}
      shortcut={shortcut}
      {...(side ? { side } : {})}
    >
      {trigger}
    </Tooltip>
  );
}
