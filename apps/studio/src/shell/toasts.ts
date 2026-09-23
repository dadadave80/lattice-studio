/**
 * The app's one toast manager (S0's `createToasts`), created with the shell so `ToastRegion` mounts with it
 * from the first render. S10's `toast()` service adds to it (`shellToasts.add`) and hears the toasts that
 * never showed through `setShellToastDrop`; until S10 registers, K2's default holds toasts and replays them
 * into S10's service.
 */
import { createToasts } from "@/ui";
import type { DroppedToast, ToastDropReason } from "@/ui/overlays/toasts";

type DropHandler = (toast: DroppedToast, reason: ToastDropReason) => void;

let onDrop: DropHandler | null = null;

export const shellToasts = createToasts({ onDrop: (toast, reason) => onDrop?.(toast, reason) });

/** Sets who hears a toast that was dropped without showing (S10 logs it). Returns a disposer. */
export function setShellToastDrop(handler: DropHandler): () => void {
  onDrop = handler;
  return () => {
    if (onDrop === handler) onDrop = null;
  };
}
