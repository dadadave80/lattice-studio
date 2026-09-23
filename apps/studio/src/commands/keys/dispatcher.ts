/**
 * The one keydown listener behind every shortcut (spec L749-L755). It listens on `window` in the bubble
 * phase, so a focused control that handles a key itself (and stops it or prevents its default) keeps it, and
 * Base UI's dialogs, menus and popovers close themselves on Esc before it hears it. S9's capture-phase
 * listener has already taken F6 and the region bindings.
 */
import type { CommandRef, Platform } from "@lattice-studio/core";
import { commandState, listBindings, runCommand, session, settings, type ResolvedBinding } from "@/contracts";
import { platform as currentPlatform } from "@/ui/shared/platform";
import { runEscape } from "../escape";
import { keyContextOf } from "./key-context";
import { resolveKey } from "./resolve";

/** The binding to run among several matching one keypress: the first whose command can run now, else the first. */
function pick(matches: readonly ResolvedBinding[]): ResolvedBinding | undefined {
  return matches.find((b) => commandState(b.ref, "keys").ok) ?? matches[0];
}

function consume(event: KeyboardEvent): void {
  event.preventDefault();
  event.stopPropagation();
}

/** What a keydown did, for tests. */
export type KeyOutcome = { ran: CommandRef } | { consumed: true } | null;

/**
 * Handles one keydown: resolves it against the bindings after the keymap, in the target's key context, and
 * runs the binding's command through the registry (a disabled command logs and announces its reason). Esc
 * runs the Esc stack while no modal dialog is open, and passes on when there's nothing to leave.
 */
export function handleKeyDown(event: KeyboardEvent, platform: Platform = currentPlatform()): KeyOutcome {
  if (event.isComposing || event.keyCode === 229 || event.defaultPrevented) return null;
  const decision = resolveKey(event, {
    bindings: listBindings(),
    context: keyContextOf(event.target),
    platform,
    singleKeys: settings.get().singleKeys,
  });
  if (decision.kind === "pass") return null;
  if (decision.kind === "consume") {
    consume(event);
    return { consumed: true };
  }
  const binding = pick(decision.matches);
  if (!binding) return null;
  if (binding.ref.id === "ui.escape") {
    // Base UI dialogs close themselves; the stack never closes one a second time.
    if (session.get().dialogs.length > 0 || runEscape() === null) return null;
    consume(event);
    return { ran: binding.ref };
  }
  consume(event);
  void runCommand(binding.ref, "keys");
  return { ran: binding.ref };
}

let users = 0;

function listener(event: KeyboardEvent): void {
  handleKeyDown(event);
}

/**
 * Installs the dispatcher on `window`. Reference-counted: every call returns its own release, and the
 * listener goes when the last is released. `services.ts` installs it for the app; tests install their own.
 */
export function installShortcuts(): () => void {
  users += 1;
  if (users === 1) window.addEventListener("keydown", listener);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    users -= 1;
    if (users === 0) window.removeEventListener("keydown", listener);
  };
}
