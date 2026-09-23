import type { CommandRef } from "@lattice-studio/core";
import { isPlaceholder } from "@/contracts";
import { MenuCommandItem } from "@/ui/overlays/MenuCommandItem";

/** A menu item that shows its command's own title once the owner registers it, and `label` until then. */
export function TitledMenuItem({ command, label }: { command: CommandRef; label: string }) {
  return <MenuCommandItem command={command} {...(isPlaceholder(command.id) ? { label } : {})} />;
}
