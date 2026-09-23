import type { Problem } from "@lattice-studio/core";
import { announce, log, runCommand, session, useCommandState } from "@/contracts";
import { Checkbox } from "@/ui";

export type AckTickProps = {
  problem: Problem;
  /** The recipe hash the acknowledgement is kept under. */
  recipeHash: `0x${string}`;
  acked: boolean;
};

/**
 * An acknowledgement tick (IR L234): Keep immutable (CORE-02), Keep example values (INIT-05), Keep single key
 * (AUTH-01) or Cut without the registry check (NET-08), labeled by `ack.set`'s own title for the code. Ticking runs
 * `ack.set`; unticking drops it from the session's acknowledgements for this recipe hash.
 */
export function AckTick({ problem, recipeHash, acked }: AckTickProps) {
  const ref = { id: "ack.set" as const, args: { problemId: problem.id } };
  const state = useCommandState(ref);
  const onChange = (checked: boolean) => {
    if (checked) {
      void runCommand(ref, "button");
      return;
    }
    session.set((s) => ({ acks: { ...s.acks, [recipeHash]: (s.acks[recipeHash] ?? []).filter((id) => id !== problem.id) } }));
    const text = `Unticked ${state.title}: it needs ticking again before you sign.`;
    log({ tag: "Note", text });
    announce(text);
  };
  return (
    <Checkbox
      label={state.title}
      description={problem.message}
      checked={acked}
      onCheckedChange={onChange}
      disabledReason={state.ok || acked ? null : state.reason}
    />
  );
}
