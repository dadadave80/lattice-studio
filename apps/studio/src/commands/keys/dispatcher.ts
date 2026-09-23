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

/** A single character, digit or symbol with no modifier (WCAG 2.1.4): held down, it shouldn't repeat-fire. */
function isSingleKeyPress(event: KeyboardEvent): boolean {
  return !event.ctrlKey && !event.altKey && !event.metaKey && event.key.length === 1;
}

/** Zoom keeps repeat, the way arrows do (IR L23): holding + or − zooms continuously. */
const REPEATS: ReadonlySet<CommandRef["id"]> = new Set(["sheet.zoomIn", "sheet.zoomOut"]);

export function handleKeyDown(event: KeyboardEvent, platform: Platform = currentPlatform()): KeyOutcome {
  if (event.isComposing || event.keyCode === 229 || event.defaultPrevented) return null;
  // Enter, Space, an arrow, Home or End on a plain (unmodified) press of a native control goes to it, not to
  // the sheet's own bindings (FX13 item c); a modifier changes what the keypress means (⌘←, ⇧←) and always
  // resolves in the ambient context.
  const plainKey = event.ctrlKey || event.altKey || event.metaKey || event.shiftKey ? undefined : event.key;
  const decision = resolveKey(event, {
    bindings: listBindings(),
    context: keyContextOf(event.target, plainKey),
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
  // A held single key or Escape shouldn't repeat-fire the command (IR L23); zoom and the arrows do.
  if (event.repeat && !REPEATS.has(binding.ref.id) && (binding.ref.id === "ui.escape" || isSingleKeyPress(event))) {
    return null;
  }
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
