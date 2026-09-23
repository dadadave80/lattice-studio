import type { CommandRef } from "@lattice-studio/core";
import type { ReactNode } from "react";
import { listBindings, runCommand, useCommandState, useSettings } from "@/contracts";
import type { IconName } from "../icons/icon-paths";
import { Button, type ButtonVariant } from "./Button";
import { IconButton } from "./IconButton";

export type CommandButtonProps = {
  command: CommandRef;
  variant?: ButtonVariant;
  size?: "medium" | "small";
  block?: boolean;
  icon?: IconName;
  /** Icon only: the command's title becomes the accessible name and tooltip. Needs `icon`. */
  iconOnly?: boolean;
  /** Visible text when it differs from the command's title (the title stays in the tooltip). */
  children?: ReactNode;
  className?: string;
};

/**
 * A button bound to a command (contracts §5.3): its title from the registry, its shortcut from the keymap,
 * `aria-disabled` with the command's reason while it can't run, and `runCommand(ref, "button")` on click,
 * which logs what happened or why not.
 */
export function CommandButton({ command, variant, size, block, icon, iconOnly = false, children, className }: CommandButtonProps) {
  const state = useCommandState(command, "button");
  const keymap = useSettings((s) => s.keymap);
  const binding = listBindings(keymap).find(
    (b) => b.ref.id === command.id && JSON.stringify(b.ref.args ?? {}) === JSON.stringify(command.args ?? {}),
  );
  const reason = state.ok ? null : state.reason;
  const run = () => void runCommand(command, "button");
  const shortcut = binding?.keys.length ? { shortcut: binding.keys } : {};
  if (iconOnly && icon) {
    return (
      <IconButton
        icon={icon}
        label={state.title}
        disabledReason={reason}
        onClick={run}
        {...shortcut}
        {...(size ? { size } : {})}
        {...(className ? { className } : {})}
      />
    );
  }
  return (
    <Button
      disabledReason={reason}
      onClick={run}
      {...(children === undefined ? {} : { tooltip: state.title })}
      {...shortcut}
      {...(variant ? { variant } : {})}
      {...(size ? { size } : {})}
      {...(block ? { block } : {})}
      {...(icon ? { icon } : {})}
      {...(className ? { className } : {})}
    >
      {children ?? state.title}
    </Button>
  );
}
