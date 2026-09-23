import { commandRef, runCommand, useCommandState } from "@/contracts";
import { IconButton } from "@/ui/buttons/IconButton";

/**
 * ↑ or ↓ on a step (spec L467): S1's `init.moveStep`, named for the step it moves ("Move VaultCoreInit up"), and
 * disabled with the reason at either end of the list.
 */
export function MoveStepButton({ path, spec, to, direction, edge }: {
  path: string;
  spec: string;
  to: number;
  direction: "up" | "down";
  /** Why the step can't go that way ("VaultCoreInit is already the first step"), else null. */
  edge: string | null;
}) {
  const ref = commandRef("init.moveStep", { path, to });
  const state = useCommandState(ref);
  const reason = edge ?? (state.ok ? null : state.reason);
  return (
    <IconButton
      icon={direction === "up" ? "arrow-up" : "arrow-down"}
      label={`Move ${spec} ${direction}`}
      size="small"
      disabledReason={reason}
      onClick={() => void runCommand(ref, "button")}
    />
  );
}
