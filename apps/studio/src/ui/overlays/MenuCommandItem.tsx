import type { CommandRef } from "@lattice-studio/core";
import { listBindings, runCommand, useCommandState, useSettings } from "@/contracts";
import type { IconName } from "../icons/icon-paths";
import { MenuItem } from "./MenuItem";

export type MenuCommandItemProps = {
  command: CommandRef;
  /** Visible text when it differs from the command's title ("Remove 2" in a selection's menu). */
  label?: string;
  icon?: IconName;
};

/**
 * A menu item bound to a command (contracts §5.3): its title from the registry, its shortcut from the keymap,
 * the command's reason while it can't run, and `runCommand(ref, "menu")` on select.
 */
export function MenuCommandItem({ command, label, icon }: MenuCommandItemProps) {
  const state = useCommandState(command, "menu");
  const keymap = useSettings((s) => s.keymap);
  const binding = listBindings(keymap).find(
    (b) => b.ref.id === command.id && JSON.stringify(b.ref.args ?? {}) === JSON.stringify(command.args ?? {}),
  );
  return (
    <MenuItem
      label={label ?? state.title}
      onSelect={() => void runCommand(command, "menu")}
      disabledReason={state.ok ? null : state.reason}
      {...(binding?.keys.length ? { shortcut: binding.keys } : {})}
      {...(icon ? { icon } : {})}
    />
  );
}
