import { Popover as BasePopover } from "@base-ui/react/popover";
import type { ReactElement, ReactNode } from "react";
import { Button } from "../buttons/Button";
import styles from "./Popover.module.css";

export type PopoverProps = {
  /** The control that opens it. It must spread the props it receives onto its element and accept a ref. */
  trigger: ReactElement;
  /** The heading; it labels the popup. */
  title: string;
  /** A line under the title; it describes the popup. */
  description?: ReactNode;
  children?: ReactNode;
  /** Show a "Close" button at the end (default false: Esc and a click outside close it). */
  closeButton?: boolean;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  /** Controlled open state (optional). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

/**
 * A non-modal popup anchored to its trigger: details and small forms. Focus moves into it when it opens;
 * Esc or a click outside closes it and returns focus to the trigger.
 */
export function Popover({
  trigger, title, description, children, closeButton = false, side = "bottom", align = "start", open, onOpenChange,
}: PopoverProps) {
  return (
    <BasePopover.Root
      {...(open === undefined ? {} : { open })}
      {...(onOpenChange ? { onOpenChange: (next: boolean) => onOpenChange(next) } : {})}
    >
      <BasePopover.Trigger render={trigger} />
      <BasePopover.Portal>
        <BasePopover.Positioner className={styles.positioner} side={side} align={align} sideOffset={4} collisionPadding={8}>
          <BasePopover.Popup className={styles.popup}>
            <BasePopover.Title className={styles.title}>{title}</BasePopover.Title>
            {description === undefined ? null : (
              <BasePopover.Description className={styles.description}>{description}</BasePopover.Description>
            )}
            {children === undefined ? null : <div className={styles.body}>{children}</div>}
            {closeButton ? (
              <div className={styles.actions}>
                <BasePopover.Close render={<Button size="small">Close</Button>} />
              </div>
            ) : null}
          </BasePopover.Popup>
        </BasePopover.Positioner>
      </BasePopover.Portal>
    </BasePopover.Root>
  );
}
