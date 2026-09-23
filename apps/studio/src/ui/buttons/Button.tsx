import { Button as BaseButton } from "@base-ui/react/button";
import type { ComponentPropsWithRef, ReactNode } from "react";
import type { KeySpec } from "@/contracts";
import { Icon } from "../icons/Icon";
import type { IconName } from "../icons/icon-paths";
import { useAriaKeyShortcuts } from "../keys/use-aria-key-shortcuts";
import { cx } from "../shared/cx";
import { ReasonTooltip } from "../tooltip/ReasonTooltip";
import styles from "./Button.module.css";

export type ButtonVariant = "primary" | "secondary" | "quiet";

export type ButtonProps = Omit<ComponentPropsWithRef<"button">, "disabled" | "className" | "children"> & {
  /** `primary` is the view's one accent-filled action (spec L349); default `secondary`. */
  variant?: ButtonVariant;
  size?: "medium" | "small";
  /** Stretch to the container's width. */
  block?: boolean;
  /** A leading icon. */
  icon?: IconName;
  /**
   * Why the button can't be used now: "Resolve 2 blockers · F8". While set, the button stays focusable with
   * `aria-disabled`, explains itself in a tooltip and its description, and never activates (spec L661).
   * There's no `disabled` prop on purpose.
   */
  disabledReason?: string | null | undefined;
  /** A tooltip for an enabled button: what a click will do. */
  tooltip?: ReactNode;
  /** Keys shown in the tooltip and set as `aria-keyshortcuts` (per platform; single keys only while they are on). */
  shortcut?: KeySpec | readonly KeySpec[];
  className?: string;
  children: ReactNode;
};

/** A text button: a verb and its object, in sentence case ("Place EmergencyStop", "Use a new salt"). */
export function Button({
  variant = "secondary", size = "medium", block = false, icon, disabledReason, tooltip, shortcut, className,
  children, type = "button", ...rest
}: ButtonProps) {
  const keyshortcuts = useAriaKeyShortcuts(shortcut);
  const button = (
    <BaseButton
      {...rest}
      {...keyshortcuts}
      type={type}
      data-variant={variant}
      className={cx(styles.button, styles[variant], size === "small" && styles.small, block && styles.block, className)}
    >
      {icon ? <Icon name={icon} /> : null}
      {children}
    </BaseButton>
  );
  return (
    <ReasonTooltip reason={disabledReason} content={tooltip} shortcut={shortcut}>
      {button}
    </ReasonTooltip>
  );
}
