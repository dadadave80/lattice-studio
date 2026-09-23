import { formatSelector, type Hex4 } from "@lattice-studio/core";
import { useId, type Ref } from "react";
import { runCommand } from "@/contracts";
import { cx, ReasonTooltip, Tooltip } from "@/ui";
import { CodeText } from "./CodeText";
import { plainCode } from "./facet-model";
import type { PinAction, PinState } from "./pin-action";
import styles from "./facet.module.css";

export type SelectorRowProps = {
  selector: { hex: Hex4; signature: string };
  action: PinAction;
  /** Read-only (Catalog preview): plain text, no action. */
  readOnly: boolean;
  /** Roving tabindex: 0 on the list's one Tab stop, -1 elsewhere. */
  tabIndex?: number;
  onFocus?: () => void;
  rowRef?: Ref<HTMLButtonElement>;
};

const STATE_CLASS: Record<PinState, string | undefined> = {
  excluded: styles.excluded,
  seam: undefined,
  default: styles.default,
  routed: styles.routed,
  served: undefined,
  contested: styles.contestedRow,
};

/**
 * One row of the Selectors list: `transfer · 0xa9059cbb` and its state in words. It acts like a pin (Flow 6):
 * Enter, Space or a click does what its tooltip says; a seam offers no route and says why.
 */
export function SelectorRow({ selector, action, readOnly, tabIndex, onFocus, rowRef }: SelectorRowProps) {
  const descriptionId = useId();
  const dense = plainCode(formatSelector(selector, "dense"));
  const content = (
    <>
      <span className={styles.signature}>{dense}</span>
      <span className={styles.state}>{action.label}</span>
    </>
  );
  const className = cx(styles.row, STATE_CLASS[action.state]);

  if (readOnly) {
    return (
      <li className={styles.rowItem}>
        <span className={className} data-selector={selector.hex} title={selector.signature}>
          {content}
        </span>
      </li>
    );
  }

  const command = action.command;
  const common = {
    ref: rowRef,
    type: "button" as const,
    className,
    "data-selector": selector.hex,
    ...(tabIndex === undefined ? {} : { tabIndex }),
    ...(onFocus ? { onFocus } : {}),
  };

  if (!command) {
    return (
      <li className={styles.rowItem}>
        <ReasonTooltip reason={plainCode(action.tooltip)}>
          <button {...common}>{content}</button>
        </ReasonTooltip>
      </li>
    );
  }

  return (
    <li className={styles.rowItem}>
      <Tooltip content={<CodeText text={action.tooltip} />}>
        <button {...common} aria-describedby={descriptionId} onClick={() => void runCommand(command, "button")}>
          {content}
          <span id={descriptionId} hidden>
            {plainCode(action.tooltip)}
          </span>
        </button>
      </Tooltip>
    </li>
  );
}
