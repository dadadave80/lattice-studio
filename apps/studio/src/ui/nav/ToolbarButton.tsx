import { Toolbar as BaseToolbar } from "@base-ui/react/toolbar";
import { use, type ComponentPropsWithRef } from "react";
import type { KeySpec } from "@/contracts";
import { Icon } from "../icons/Icon";
import type { IconName } from "../icons/icon-paths";
import { useAriaKeyShortcuts } from "../keys/use-aria-key-shortcuts";
import { cx } from "../shared/cx";
import type { TooltipSide } from "../tooltip/Tooltip";
import { ReasonTooltip } from "../tooltip/ReasonTooltip";
import { ToolbarOrientationContext } from "./toolbar-orientation";
import styles from "./Toolbar.module.css";

export type ToolbarButtonProps = Omit<
  ComponentPropsWithRef<"button">, "disabled" | "className" | "children" | "aria-label" | "aria-pressed"
> & {
  icon: IconName;
  /** The accessible name and tooltip: "Zoom in". */
  label: string;
  /** Shown in the tooltip and set as `aria-keyshortcuts`, per platform. */
  shortcut?: KeySpec | readonly KeySpec[];
  /** Set for a tool toggle (Select, Hand): `aria-pressed`, drawn with the accent edge and soft fill. */
  pressed?: boolean;
  /** Why the button can't be used now. It stays focusable and reachable with the arrows, and never activates. */
  disabledReason?: string | null | undefined;
  /** Default: right of a vertical toolbar, above a horizontal one. */
  tooltipSide?: TooltipSide;
  className?: string | undefined;
};

/** An icon button inside a `Toolbar`: its label is its name and tooltip, with the shortcut beside it. */
export function ToolbarButton({
  icon, label, shortcut, pressed, disabledReason, tooltipSide, className, type = "button", ...rest
}: ToolbarButtonProps) {
  const orientation = use(ToolbarOrientationContext);
  const keyshortcuts = useAriaKeyShortcuts(shortcut);
  return (
    <ReasonTooltip
      reason={disabledReason}
      content={label}
      shortcut={shortcut}
      side={tooltipSide ?? (orientation === "vertical" ? "right" : "top")}
    >
      <BaseToolbar.Button
        {...rest}
        type={type}
        aria-label={label}
        {...keyshortcuts}
        {...(pressed === undefined ? {} : { "aria-pressed": pressed })}
        className={cx(styles.button, className)}
      >
        <Icon name={icon} />
      </BaseToolbar.Button>
    </ReasonTooltip>
  );
}
