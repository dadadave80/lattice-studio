import { Toolbar as BaseToolbar } from "@base-ui/react/toolbar";
import type { KeyboardEvent, ReactNode } from "react";
import { cx } from "../shared/cx";
import { ToolbarOrientationContext, type ToolbarOrientation } from "./toolbar-orientation";
import styles from "./Toolbar.module.css";

const ITEMS = "button:not([disabled]), input:not([disabled]), a[href]";

export type ToolbarProps = {
  /** The accessible name: "Sheet tools". */
  label: string;
  orientation?: ToolbarOrientation;
  /** `ToolbarButton`s, `ToolbarGroup`s and `ToolbarSeparator`s. */
  children: ReactNode;
  className?: string | undefined;
};

/**
 * A toolbar (APG toolbar): one Tab stop; the arrows along its orientation move between controls, Home and End
 * go to the ends. Disabled buttons stay reachable and say why.
 */
export function Toolbar({ label, orientation = "horizontal", children, className }: ToolbarProps) {
  // Base UI's toolbar moves with the arrows only; Home and End go to the first and last control (APG toolbar).
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Home" && event.key !== "End") return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.target instanceof HTMLInputElement) return;
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>(ITEMS)];
    const target = event.key === "Home" ? items[0] : items.at(-1);
    if (!target) return;
    event.preventDefault();
    target.focus();
  };
  return (
    <ToolbarOrientationContext value={orientation}>
      <BaseToolbar.Root
        aria-label={label}
        orientation={orientation}
        className={cx(styles.toolbar, className)}
        onKeyDown={onKeyDown}
      >
        {children}
      </BaseToolbar.Root>
    </ToolbarOrientationContext>
  );
}

/** A hairline between groups of toolbar controls. */
export function ToolbarSeparator({ className }: { className?: string | undefined }) {
  return <BaseToolbar.Separator className={cx(styles.separator, className)} />;
}

export type ToolbarGroupProps = {
  /** Name a group when its purpose isn't plain from its buttons ("Zoom"). */
  label?: string;
  children: ReactNode;
  className?: string | undefined;
};

/** Related toolbar controls, kept together. */
export function ToolbarGroup({ label, children, className }: ToolbarGroupProps) {
  return (
    <BaseToolbar.Group {...(label ? { "aria-label": label } : {})} className={cx(styles.group, className)}>
      {children}
    </BaseToolbar.Group>
  );
}
