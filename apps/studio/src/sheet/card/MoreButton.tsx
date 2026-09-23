import type { MouseEvent } from "react";
import { commandRef, runCommand } from "@/contracts";
import { cx, ReasonTooltip } from "@/ui";
import styles from "./FacetCard.module.css";

export type MoreButtonProps = {
  facet: string;
  expanded: boolean;
  /** Rows behind the button while collapsed. */
  hidden: number;
  readOnly: string | null;
  side: "left" | "right";
};

/**
 * "+ n more" on a collapsed card with more than 9 selectors, Collapse on an expanded one (spec L479, IR L105).
 * Expanding is a layout edit: `layout.toggleExpand`, one undo step, pushing the cards below it down (S1).
 */
export function MoreButton({ facet, expanded, hidden, readOnly, side }: MoreButtonProps) {
  const toggle = (event: MouseEvent) => {
    event.stopPropagation();
    void runCommand(commandRef("layout.toggleExpand", { facet }), "button");
  };
  return (
    <ReasonTooltip reason={readOnly}>
      <button
        type="button"
        tabIndex={-1}
        className={cx(styles.more, side === "right" && styles.moreRight, "nodrag", "nopan")}
        data-card-row=""
        aria-expanded={expanded}
        onClick={toggle}
      >
        {expanded ? "Collapse" : `+ ${hidden} more`}
      </button>
    </ReasonTooltip>
  );
}
