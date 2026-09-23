import { createElement } from "react";
import { dialogComponent, useSession, type DialogEntry } from "@/contracts";
import { NotBuiltDialog } from "./NotBuiltDialog";

function HostedDialog({ entry, top }: { entry: DialogEntry; top: boolean }) {
  const component = dialogComponent(entry.id);
  return component ? createElement(component, { entry, top }) : <NotBuiltDialog entry={entry} top={top} />;
}

/**
 * Renders the session's dialog stack, bottom first, each through the component its owner registered
 * (`registerDialog`). Only the last is interactive; the ones below stay mounted but inert. A dialog with no
 * component yet shows `NotBuiltDialog`.
 */
export function DialogHost() {
  const dialogs = useSession((s) => s.dialogs);
  return (
    <>
      {dialogs.map((entry, i) => (
        <HostedDialog key={entry.key} entry={entry} top={i === dialogs.length - 1} />
      ))}
    </>
  );
}
