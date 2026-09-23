import type { ComponentPropsWithRef } from "react";
import { cx } from "@/ui/shared/cx";
import { VisuallyHidden } from "@/ui/shared/VisuallyHidden";
import { badgeText } from "./init-order-model";
import styles from "./InitBadge.module.css";

export type BadgeProps = {
  number: number;
  /** The recipe step, for a badge that can be dragged; null when the order is fixed. */
  index: number | null;
};

/**
 * The badge as drawn: "03" in a small box after the card's name (IR L103). It takes no focus and has no
 * tooltip: the legend says whether the order can be dragged or is fixed, and the step list is the keyboard way.
 */
export function BadgeFace({ number, index, className, ...rest }: BadgeProps & ComponentPropsWithRef<"span">) {
  return (
    <span {...rest} className={cx(styles.badge, className)} data-init-step={number} data-init-index={index ?? undefined}>
      <span aria-hidden="true">{badgeText(number)}</span>
      <VisuallyHidden>{`Init step ${number}`}</VisuallyHidden>
    </span>
  );
}
