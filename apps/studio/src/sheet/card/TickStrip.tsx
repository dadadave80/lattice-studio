import { cx } from "@/ui";
import type { PinView } from "./card-model";
import styles from "./FacetCard.module.css";

export type TickStripProps = {
  pins: readonly PinView[];
  side: "left" | "right";
};

/**
 * The compact card's body below 40% zoom (spec L481, PA L56): one tick per exported selector, filled when it
 * routes here, hollow when it doesn't, hatched when it's contested. Decorative: the card's name and
 * description carry the counts in words.
 */
export function TickStrip({ pins, side }: TickStripProps) {
  return (
    <div className={cx(styles.strip, side === "right" && styles.stripRight)} aria-hidden="true">
      {pins.map((pin) => (
        <span
          key={pin.selector}
          className={cx(styles.stripTick, pin.here ? styles.stripHere : styles.stripAway, pin.state === "contested" && styles.stripContested)}
          data-state={pin.state}
        />
      ))}
    </div>
  );
}
