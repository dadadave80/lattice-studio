/**
 * The `toast()` service (contracts §5.2, spec L731-L735): adds to S3's `shellToasts` (the one instance the
 * shell mounts `ToastRegion` with, from the first render) and registers this module as its drop logger.
 * Every toast is a console line, whether it shows, waits or is dropped outright (spec L733); a dropped toast
 * also gets a dim note naming why.
 */
import { log, type ToastInput } from "@/contracts";
import { setShellToastDrop, shellToasts } from "@/shell";
import type { DroppedToast, ToastDropReason } from "@/ui/overlays/toasts";

function describeDrop(toast: DroppedToast, reason: ToastDropReason): string {
  switch (reason) {
    case "held":
      return `${toast.text} (held back by an error).`;
    case "expired":
      return `${toast.text} (its own time ran out before it could show).`;
    case "cap":
      return `${toast.text} (too many notifications were waiting).`;
    case "replaced":
      return `${toast.text} (replaced by a newer notification).`;
    case "dismissed":
      return `${toast.text} (dismissed).`;
    case "cleared":
      return `${toast.text} (cleared).`;
  }
}

/** Hears every toast `shellToasts` drops without showing; registered below with `setShellToastDrop`. */
function onDrop(toast: DroppedToast, reason: ToastDropReason): void {
  log({ tag: "Note", text: describeDrop(toast, reason), dim: true });
}

export const stopDropLogging: () => void = setShellToastDrop(onDrop);

/** The console line every toast gets, regardless of whether it ever shows (spec L733). */
function logToast(input: ToastInput): void {
  log({ tag: input.kind === "error" ? "Error" : "Note", text: input.text });
}

/** The real `toast()` implementation: logs the console line, then queues it on the shell's toast region. */
export function addToast(input: ToastInput): void {
  logToast(input);
  shellToasts.add(input);
}
