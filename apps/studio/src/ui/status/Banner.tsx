import type { ReactNode } from "react";
import type { BannerProps as ServiceBannerProps } from "@/contracts";
import { CommandButton } from "../buttons/CommandButton";
import { IconButton } from "../buttons/IconButton";
import { Icon } from "../icons/Icon";
import type { IconName } from "../icons/icon-paths";
import { cx } from "../shared/cx";
import styles from "./Banner.module.css";

export type BannerTone = NonNullable<ServiceBannerProps["tone"]>;

export type BannerProps = ServiceBannerProps & {
  /** Called by the "Close" button, which shows when `dismissible`. */
  onDismiss?: () => void;
  /** Extra controls after the command buttons. */
  children?: ReactNode;
  className?: string;
};

/** The icon and its accessible name: severity is a shape and a word, never color alone (spec L674). */
const TONES: Record<BannerTone, { icon: IconName; word: string }> = {
  info: { icon: "info", word: "Note" },
  warning: { icon: "warning", word: "Warning" },
  error: { icon: "error", word: "Error" },
};

/**
 * A banner across a region (contracts §5.2 `showBanner`; S10 hosts them). Its actions run through the
 * command registry, labelled with each command's title and disabled with its reason.
 */
export function Banner({ text, tone = "info", actions = [], dismissible = false, onDismiss, children, className }: BannerProps) {
  const { icon, word } = TONES[tone];
  return (
    <div className={cx(styles.banner, styles[tone], className)} data-tone={tone}>
      <Icon name={icon} label={word} className={styles.icon} />
      <p className={styles.text}>{text}</p>
      {actions.length > 0 || children ? (
        <div className={styles.actions}>
          {actions.map((ref) => (
            <CommandButton key={`${ref.id}${JSON.stringify(ref.args ?? {})}`} command={ref} size="small" />
          ))}
          {children}
        </div>
      ) : null}
      {dismissible ? <IconButton icon="close" label="Close" size="small" {...(onDismiss ? { onClick: onDismiss } : {})} /> : null}
    </div>
  );
}
