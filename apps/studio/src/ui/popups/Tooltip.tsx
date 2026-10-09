import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import type { ReactElement, ReactNode } from "react";
import type { KeySpec } from "@/contracts";
import { ShortcutChip } from "../keys/ShortcutChip";
import styles from "../tooltip/Tooltip.module.css";

export type TooltipSide = "top" | "bottom" | "left" | "right";

export type TooltipProps = {
  /** What a click will do, or the control's name. Visible text only: give the trigger its own accessible name. */
  content: ReactNode;
  /** A second, muted line: why the control is disabled (see `ReasonTooltip`). */
  reason?: string | null | undefined;
  /** Keys shown beside the content, per platform. */
  shortcut?: KeySpec | readonly KeySpec[] | undefined;
  /** The trigger. It must spread the props it receives onto its element and accept a ref. */
  children: ReactElement;
  side?: TooltipSide;
  /** Controlled open state. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Close when the trigger is clicked (default true). */
  closeOnClick?: boolean;
  /** Hover delay in ms (default 600). */
  delay?: number;
  /**
   * Never open, and close if open. The trigger keeps its element either way, so a tooltip that comes and goes
   * with state (a reason) should stay rendered and toggle this rather than unwrap its trigger (spec L753).
   */
  disabled?: boolean;
};

/**
 * A tooltip on hover and focus. It stays open while the pointer is over it and closes with Esc (spec L779,
 * WCAG 1.4.13). Tooltips are visual only: the trigger carries its own accessible name, and a disabled
 * control's reason reaches assistive technology through `ReasonTooltip`'s description.
 */
export function Tooltip({
  content, reason, shortcut, children, side = "top", open, onOpenChange, closeOnClick = true, delay, disabled = false,
}: TooltipProps) {
  const control = open === undefined ? {} : { open };
  const handler = onOpenChange ? { onOpenChange: (next: boolean) => onOpenChange(next) } : {};
  return (
    <BaseTooltip.Root {...control} {...handler} disabled={disabled}>
      <BaseTooltip.Trigger render={children} closeOnClick={closeOnClick} {...(delay === undefined ? {} : { delay })} />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner className={styles.positioner} side={side} sideOffset={8} collisionPadding={8}>
          <BaseTooltip.Popup className={styles.popup} data-tooltip="">
            <span className={styles.line}>
              <span>{content}</span>
              {shortcut === undefined ? null : <ShortcutChip keys={shortcut} />}
            </span>
            {reason ? <span className={styles.reason}>{reason}</span> : null}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}
