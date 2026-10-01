import { useAnalysis, useSession } from "@/contracts";
import { planIndex, stampText } from "./plan-index";
import styles from "./CardStamp.module.css";

/** The stamp's body: mounted only while the core is selected, so cards at rest never subscribe to the plan. */
function Stamp({ name }: { name: string }) {
  const index = useAnalysis((a) => planIndex(a.plan, name));
  return (
    <span className={styles.stamp} data-stamp={stampText(index)} data-not-cut={index === null ? "" : undefined} aria-hidden="true">
      {stampText(index)}
    </span>
  );
}

/**
 * The card's cut-plan index, stamped above its top-left corner while the core is selected ("02", the core's two
 * entries first; "Not cut" for a card that routes nothing). Decorative: the inspector's cut plan lists the same
 * numbers. Outside the card's box and no pointer, like the ground glyph.
 */
export function CardStamp({ name }: { name: string }) {
  const on = useSession((s) => s.coreSelected);
  return on ? <Stamp name={name} /> : null;
}
