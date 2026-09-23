import { Button as BaseButton } from "@base-ui/react/button";
import type { ComponentPropsWithRef } from "react";
import type { KeySpec } from "@/contracts";
import { Icon } from "../icons/Icon";
import type { IconName } from "../icons/icon-paths";
import { ariaKeyShortcuts } from "../keys/key-labels";
import { cx } from "../shared/cx";
import { usePlatform } from "../shared/platform";
import type { TooltipSide } from "../tooltip/Tooltip";
import { ReasonTooltip } from "../tooltip/ReasonTooltip";
import styles from "./Button.module.css";

export type IconButtonProps = Omit<ComponentPropsWithRef<"button">, "disabled" | "className" | "children" | "aria-label"> & {
  icon: IconName;
  /** The accessible name, also shown as the tooltip ("Zoom in", "Undo"). */
  label: string;
  /** Shown in the tooltip and set as `aria-keyshortcuts`, per platform. */
  shortcut?: KeySpec | readonly KeySpec[];
  /** 28 px (default) or 24 px square; never smaller (spec L770). */
  size?: "medium" | "small";
  /** See `Button`: aria-disabled, the reason in the tooltip and description, no activation. */
  disabledReason?: string | null | undefined;
  tooltipSide?: TooltipSide;
  className?: string;
};

/** An icon-only button. Its label is its accessible name and its tooltip, with the shortcut beside it. */
export function IconButton({
  icon, label, shortcut, size = "medium", disabledReason, tooltipSide, className, type = "button", ...rest
}: IconButtonProps) {
  const platform = usePlatform();
  const keyshortcuts = ariaKeyShortcuts(shortcut, platform);
  return (
    <ReasonTooltip reason={disabledReason} content={label} shortcut={shortcut} {...(tooltipSide ? { side: tooltipSide } : {})}>
      <BaseButton
        {...rest}
        type={type}
        aria-label={label}
        {...(keyshortcuts ? { "aria-keyshortcuts": keyshortcuts } : {})}
        className={cx(styles.button, styles.icon, size === "small" && styles.small, className)}
      >
        <Icon name={icon} />
      </BaseButton>
    </ReasonTooltip>
  );
}
