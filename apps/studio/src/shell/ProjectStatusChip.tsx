import { commandRef, runCommand, useCommandState } from "@/contracts";
import { ReasonTooltip, StatusChip } from "@/ui";
import type { StatusChipWords } from "./status";
import styles from "./TitleBar.module.css";

const SHOW_DEPLOYMENTS = commandRef("deployments.show");

/**
 * The status chip (IR L67): the diamond's state on the selected chain. A click opens the Deployments list
 * (`deployments.show`); while that can't run, the chip says why. When the title bar is crowded it shrinks
 * to its dot and one word.
 */
export function ProjectStatusChip({ chip, compact }: { chip: StatusChipWords; compact: boolean }) {
  const show = useCommandState(SHOW_DEPLOYMENTS);
  return (
    <ReasonTooltip reason={show.ok ? null : show.reason}>
      <button
        type="button"
        className={styles.chip}
        data-status-chip=""
        onClick={() => void runCommand(SHOW_DEPLOYMENTS, "button")}
      >
        <StatusChip tone={chip.tone} text={chip.text} compact={compact} />
      </button>
    </ReasonTooltip>
  );
}
