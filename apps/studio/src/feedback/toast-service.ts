/**
 * The `toast()` service (contracts §5.2, spec L731-L735): one toast manager for the whole app, built on
 * S0/FX9's `createToasts`. Every toast is a console line, whether it shows, waits or is dropped outright
 * (spec L733); a dropped toast also gets a dim note naming why, from `onDrop`.
 *
 * S3's shell is expected to export `shellToasts` (its own `createToasts()` instance) and
 * `setShellToastDrop(fn)` once it lands (contracts §5.2 `toast`, `region "toasts"`); this module then wires
 * `toast()` to `shellToasts.add` instead of keeping its own instance (see the module doc in `services.ts`).
 * Until then this is the one instance the app has, and `Toasts` (this module's component) mounts its region.
 */
import { log, type ToastInput } from "@/contracts";
import { createToasts, type Toasts as ToastsHandle } from "@/ui";
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

function onDrop(toast: DroppedToast, reason: ToastDropReason): void {
  log({ tag: "Note", text: describeDrop(toast, reason), dim: true });
}

/** The app's one toast manager, until S3's `shellToasts` replaces it. */
export const toasts: ToastsHandle = createToasts({ onDrop });

/** The console line every toast gets, regardless of whether it ever shows (spec L733). */
function logToast(input: ToastInput): void {
  log({ tag: input.kind === "error" ? "Error" : "Note", text: input.text });
}

/** The real `toast()` implementation: logs the console line, then queues it. */
export function addToast(input: ToastInput): void {
  logToast(input);
  toasts.add(input);
}
