import { commandRef, runCommand, useCommandState } from "@/contracts";
import { Button, IconButton } from "@/ui";

const SHARE = commandRef("share.copyLink");

/** Share (IR L70): copies a share link (Flow 10). Icon only where the title bar is short of room. */
export function ShareButton({ iconOnly }: { iconOnly: boolean }) {
  const state = useCommandState(SHARE);
  const reason = state.ok ? null : state.reason;
  const run = () => void runCommand(SHARE, "button");
  return iconOnly ? (
    <IconButton icon="share" label="Share" disabledReason={reason} onClick={run} />
  ) : (
    <Button icon="share" size="small" disabledReason={reason} onClick={run}>
      Share
    </Button>
  );
}
