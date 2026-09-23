import type { ComponentPropsWithRef } from "react";
import { cx } from "@/ui/shared/cx";
import { VisuallyHidden } from "@/ui/shared/VisuallyHidden";
import { badgeText } from "./init-order-model";
import styles from "./InitBadge.module.css";

export type BadgeProps = {
  number: number;
  /** The recipe step, for a badge that can be dragged; null when the order is fixed. */
  index: number | null;
  /** The bundle whose fixed order this is, or null for step inits. */
  bundle: string | null;
};

/** What a badge says to a pointer: its step, and whether dragging it reorders. */
export function badgeTitle({ number, index, bundle }: BadgeProps): string {
  if (index !== null) return `Init step ${number}. Drag to reorder.`;
  return bundle ? `Init step ${number}, fixed by ${bundle}.` : `Init step ${number}, fixed.`;
}

/** The badge as drawn: "03" in a small box after the card's name (IR L103). */
export function BadgeFace({ number, index, bundle, className, ...rest }: BadgeProps & ComponentPropsWithRef<"span">) {
  return (
    <span
      {...rest}
      className={cx(styles.badge, className)}
      data-init-step={number}
      data-init-index={index ?? undefined}
      title={badgeTitle({ number, index, bundle })}
    >
      <span aria-hidden="true">{badgeText(number)}</span>
      <VisuallyHidden>{`Init step ${number}`}</VisuallyHidden>
    </span>
  );
}
