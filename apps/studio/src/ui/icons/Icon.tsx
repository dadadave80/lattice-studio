import { cx } from "../shared/cx";
import styles from "./Icon.module.css";
import { ICON_PATHS, type IconName } from "./icon-paths";

export type IconProps = {
  name: IconName;
  /** 12, 16 (default) or 24 px. */
  size?: "small" | "medium" | "large";
  /**
   * The icon's accessible name when it carries meaning on its own (a severity: "Warning"). Omit it when a
   * visible word or the control's label already says it: the icon is then hidden from assistive technology.
   */
  label?: string;
  className?: string | undefined;
};

/** One icon from the provisional inline set, drawn in `currentColor`. */
export function Icon({ name, size = "medium", label, className }: IconProps) {
  const a11y = label ? { role: "img", "aria-label": label } : { "aria-hidden": true as const };
  return (
    <svg
      viewBox="0 0 24 24"
      focusable="false"
      data-icon={name}
      className={cx(styles.icon, size === "small" && styles.small, size === "large" && styles.large, className)}
      {...a11y}
    >
      {ICON_PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
