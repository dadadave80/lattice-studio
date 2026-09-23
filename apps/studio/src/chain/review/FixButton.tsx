import type { CommandRef } from "@lattice-studio/core";
import type { ReactNode } from "react";
import { isPlaceholder, useCommandState } from "@/contracts";
import { CommandButton, type ButtonVariant, type IconName } from "@/ui";
import { FIX_TITLES } from "./copy";

export type FixButtonProps = {
  command: CommandRef;
  variant?: ButtonVariant;
  icon?: IconName;
  children?: ReactNode;
};

/**
 * A command's button in the review. While the command's owner hasn't landed, its placeholder's title is only its id,
 * so the button says what the spec calls it and the placeholder's reason ("Not built yet · WP-S8c") explains why it
 * can't run yet.
 */
export function FixButton({ command, variant, icon, children }: FixButtonProps) {
  // Re-renders when a registration replaces the placeholder.
  useCommandState(command);
  const text = children ?? (isPlaceholder(command.id) ? FIX_TITLES[command.id] : undefined);
  return (
    <CommandButton command={command} size="small" {...(variant ? { variant } : {})} {...(icon ? { icon } : {})}>
      {text}
    </CommandButton>
  );
}
