import type { CommandRef } from "@lattice-studio/core";
import { useId, type ReactNode, type Ref } from "react";
import { runCommand, useCommandState } from "@/contracts";
import { ReasonTooltip, Tooltip } from "@/ui";
import { CodeText } from "./CodeText";
import { plainCode } from "./facet-model";

export type CommandSelectorRowProps = {
  command: CommandRef;
  /** What a click will do (Flow 6), with `code` spans in backticks. */
  tooltip: string;
  content: ReactNode;
  button: {
    ref: Ref<HTMLButtonElement> | undefined;
    type: "button";
    className: string;
    "data-selector": string;
    tabIndex?: number;
    onFocus?: () => void;
  };
};

/**
 * A Selectors row whose pin action is a command. While the command can't run (a read-only session, a neighbor
 * not built yet) the row stays focusable, `aria-disabled`, and says why, as every disabled control does
 * (spec L661).
 */
export function CommandSelectorRow({ command, tooltip, content, button }: CommandSelectorRowProps) {
  const descriptionId = useId();
  const state = useCommandState(command, "button");
  if (!state.ok) {
    return (
      <ReasonTooltip reason={state.reason}>
        <button {...button}>{content}</button>
      </ReasonTooltip>
    );
  }
  return (
    <Tooltip content={<CodeText text={tooltip} />}>
      <button {...button} aria-describedby={descriptionId} onClick={() => void runCommand(command, "button")}>
        {content}
        <span id={descriptionId} hidden>
          {plainCode(tooltip)}
        </span>
      </button>
    </Tooltip>
  );
}
