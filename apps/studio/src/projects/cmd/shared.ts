/**
 * What every S7b command shares: enablement helpers, the console line and status-region pair every command
 * ends with (spec L413: no silent no-ops), and the reset a project switch gives session state (new, open,
 * import) so a stale selection or mode never survives onto a different sheet (spec L409).
 */
import { announce, log, session, type Enablement } from "@/contracts";

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
