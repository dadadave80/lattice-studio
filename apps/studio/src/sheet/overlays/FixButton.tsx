import type { CommandRef } from "@lattice-studio/core";
import { runCommand, useCommandState } from "@/contracts";
import { Button } from "@/ui/buttons/Button";

/**
 * A note's fix as a real button (IR L108): the command's title, its reason while it can't run, and
 * `runCommand(ref, "button")` on click. Fixes carry no shortcut, so unlike `CommandButton` it never walks the
 * keymap on render, which keeps a sheet full of notes cheap to draw.
 */
export function FixButton({ command }: { command: CommandRef }) {
  const state = useCommandState(command, "button");
  return (
    <Button size="small" disabledReason={state.ok ? null : state.reason} onClick={() => void runCommand(command, "button")}>
      {state.title}
    </Button>
  );
}
