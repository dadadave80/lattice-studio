import { Toggle } from "@base-ui/react/toggle";
import type { ReactNode } from "react";
import type { KeySpec } from "@/contracts";
import { Icon } from "../icons/Icon";
import type { IconName } from "../icons/icon-paths";
import { ariaKeyShortcuts } from "../keys/key-labels";
import { cx } from "../shared/cx";
import { usePlatform } from "../shared/platform";
import type { TooltipSide } from "../tooltip/Tooltip";
import { ReasonTooltip } from "../tooltip/ReasonTooltip";
import styles from "./Toggle.module.css";

type ToggleCommon = {
  /** Controlled state. */
  pressed?: boolean;
  /** Uncontrolled initial state. */
  defaultPressed?: boolean;
  onPressedChange?: (pressed: boolean) => void;
  size?: "medium" | "small";
  /**
   * Why it can't be toggled now ("Connect a wallet first"). While set it stays focusable with
   * `aria-disabled`, is described by the reason, shows it in a tooltip and never changes (spec L661).
   */
  disabledReason?: string | null | undefined;
  /** Keys shown in the tooltip and set as `aria-keyshortcuts`, per platform. */
  shortcut?: KeySpec | readonly KeySpec[];
  tooltipSide?: TooltipSide;
  className?: string | undefined;
};

export type ToggleButtonProps = ToggleCommon &
  (
    | {
        /** Icon only: `label` is its accessible name and its tooltip ("Show minimap"). */
        icon: IconName;
        label: string;
        children?: never;
      }
    | {
        /** Sentence-case text, which is the accessible name ("Minimap"). */
        children: ReactNode;
        /** A leading icon beside the text. */
        icon?: IconName;
        /** A tooltip for the text button: what pressing it does. */
        label?: string;
      }
  );

/** A button that stays pressed (`aria-pressed`): a view option, a filter. Space and Enter toggle it. */
export function ToggleButton(props: ToggleButtonProps) {
  const {
    pressed, defaultPressed, onPressedChange, size = "medium", disabledReason, shortcut, tooltipSide, className,
    icon, label, children,
  } = props;
  const platform = usePlatform();
  const keyshortcuts = ariaKeyShortcuts(shortcut, platform);
  const iconOnly = children === undefined;
  return (
    <ReasonTooltip
      reason={disabledReason}
      {...(label === undefined ? {} : { content: label })}
      shortcut={shortcut}
      {...(tooltipSide ? { side: tooltipSide } : {})}
    >
      <Toggle
        {...(pressed === undefined ? {} : { pressed })}
        {...(defaultPressed === undefined ? {} : { defaultPressed })}
        {...(iconOnly && label ? { "aria-label": label } : {})}
        {...(keyshortcuts ? { "aria-keyshortcuts": keyshortcuts } : {})}
        onPressedChange={(next, details) => {
          if (disabledReason) {
            details.cancel();
            return;
          }
          onPressedChange?.(next);
        }}
        className={cx(styles.toggle, styles.pressedMark, iconOnly && styles.icon, size === "small" && styles.small, className)}
      >
        {icon ? <Icon name={icon} /> : null}
        {children}
      </Toggle>
    </ReasonTooltip>
  );
}
