import { memo } from "react";
import { cx } from "@/ui/shared/cx";
import { groundCount, groundState } from "./card-model";
import styles from "./CardGround.module.css";

/** ⏚: a stem, then three bars, in a 14 × 16 box with the stem on x 0. */
const GROUND = "M0 0 V9 M-7 9 H7 M-4.5 12.5 H4.5 M-2 16 H2";
/** Nothing routed: the stem, dashed, ends in the schematic no-connect cross. */
const NO_CONNECT_STEM = "M0 0 V9";
const NO_CONNECT_CROSS = "M-3.5 9.5 L3.5 16.5 M3.5 9.5 L-3.5 16.5";

export type CardGroundProps = {
  /** Selectors routed to this card. */
  routed: number;
  /** Selectors the facet exports. */
  exported: number;
  /** The diamond's cut facet: "cut · 9". */
  cut: boolean;
  /** The card's pin side: the glyph hangs under that bottom corner. */
  side: "left" | "right";
  /** Below 40% zoom the count hides; the mark stays. */
  compact: boolean;
  /** The card is selected: its trace is live, and so is the glyph. */
  live: boolean;
};

/**
 * The ground glyph under a card's pin-side bottom corner: the selectors routed to the diamond through it ("9 ⏚",
 * "7/9 ⏚", the cut facet's "cut · 9 ⏚"), or, with none routed, "0/3" with a dashed stem ending in ✕. Decorative:
 * the card's description says the same in words. It sits outside the card's box and takes no pointer, so React
 * Flow's measured size and the card's hit area are exactly the card's. Screen-sized down to 50% zoom, then
 * scaled with the sheet, so it never reaches the next card in a tidy column. It lights with the card (hover,
 * focus), with the core (`data-core-lit` on the sheet) and, for the cut facet, with the core's CUT pad.
 */
export const CardGround = memo(function CardGround({ routed, exported, cut, side, compact, live }: CardGroundProps) {
  const state = groundState(routed, exported);
  const count = groundCount(routed, exported);
  return (
    <span
      className={cx(styles.ground, side === "right" ? styles.right : styles.left)}
      data-ground={state}
      data-ground-count={count}
      data-cut={cut ? "" : undefined}
      data-live={live ? "" : undefined}
      aria-hidden="true"
    >
      {compact ? null : <span className={styles.count}>{cut ? `cut · ${count}` : count}</span>}
      <svg className={styles.mark} viewBox="-7 0 14 16" focusable="false">
        {state === "none" ? (
          <>
            <path className={styles.dashed} d={NO_CONNECT_STEM} />
            <path d={NO_CONNECT_CROSS} />
          </>
        ) : (
          <path d={GROUND} />
        )}
      </svg>
    </span>
  );
});
