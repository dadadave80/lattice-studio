import type { MouseEvent } from "react";
import { commandRef, runCommand, useCommandState } from "@/contracts";
import { cx, ReasonTooltip } from "@/ui";
import styles from "./FacetCard.module.css";

export type MoreButtonProps = {
  facet: string;
  expanded: boolean;
  /** Rows behind the button while collapsed. */
  hidden: number;
  side: "left" | "right";
};

/**
 * "+ n more" on a collapsed card with more than 9 selectors, Collapse on an expanded one (spec L479, IR L105).
 * Expanding is a layout edit: `layout.toggleExpand`, one undo step, pushing the cards below it down (S1). The
 * row stays 20 px for C9's geometry; its hit area reaches 24 px into the padding below it.
 */
export function MoreButton({ facet, expanded, hidden, side }: MoreButtonProps) {
  const ref = commandRef("layout.toggleExpand", { facet });
  const command = useCommandState(ref);
  const toggle = (event: MouseEvent) => {
    event.stopPropagation();
    void runCommand(ref, "button");
  };
  return (
    <ReasonTooltip reason={command.ok ? null : command.reason}>
      <button
        type="button"
        tabIndex={-1}
        className={cx(styles.more, side === "right" && styles.moreRight, "nodrag")}
        data-card-row=""
        aria-expanded={expanded}
        onClick={toggle}
      >
        {expanded ? "Collapse" : `+ ${hidden} more`}
      </button>
    </ReasonTooltip>
  );
}
