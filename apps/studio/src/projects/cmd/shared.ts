/**
 * What every S7b command shares: enablement helpers, the console line and status-region pair every command
 * ends with (spec L413: no silent no-ops), and the reset a project switch gives session state (new, open,
 * import) so a stale selection or mode never survives onto a different sheet (spec L409).
 */
import { announce, log, session, toast, type Enablement } from "@/contracts";
import { openFailureText, showOpenFailure } from "@/persist";

export const OK: Enablement = { ok: true };

export function disabled(reason: string): Enablement {
  return { ok: false, reason };
}

export function isString(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

/** A console Note, and the same text to the status region (spec L413). */
export function sayNote(text: string): void {
  log({ tag: "Note", text });
  announce(text);
}

/** A console Error, kept until cleared (spec L733). */
export function sayError(text: string): void {
  log({ tag: "Error", text });
  announce(text);
}

/** After a project switch (New, Open, an import): selection, focus and modes never carry over (PA #5, #16). */
export function resetForProjectSwitch(): void {
  session.set({ selection: [], focus: null, modes: { initOrder: false, moveTo: false, rows: null } });
}

/**
 * A project (stored, or from a file) that couldn't be opened (spec L501, L696): the sheet's error state
 * names the file, the path and the reason, so it's the right channel when nothing hides the sheet. With a
 * dialog open (Settings, Share, Clear data…) the sheet sits behind it (spec L733: toasts are for results
 * outside the current view), so a toast carries the same text instead — its own console line replaces
 * `showOpenFailure`'s, keeping exactly one Error line either way, never both.
 */
export function reportOpenFailure(reason: string, details: readonly string[] = []): void {
  if (session.get().dialogs.length > 0) {
    toast({ text: openFailureText(reason), kind: "error" });
    return;
  }
  showOpenFailure(reason, details);
}
