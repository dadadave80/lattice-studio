/**
 * Whether the title bar has given up the project name (under 768 px, when even a few letters of it don't fit
 * beside the status chip), so the pane switcher's Sheet tab carries it instead. The title bar writes it; the
 * switcher, its sibling in the title bar region, reads it.
 */
import { useSyncExternalStore } from "react";

let hidden = false;
const listeners = new Set<() => void>();

export function setTitleNameHidden(next: boolean): void {
  if (next === hidden) return;
  hidden = next;
  for (const listener of Array.from(listeners)) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useTitleNameHidden(): boolean {
  return useSyncExternalStore(subscribe, () => hidden, () => false);
}
