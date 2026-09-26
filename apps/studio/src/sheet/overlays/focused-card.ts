/**
 * The card keyboard focus is in, for the traces: a trace's reason shows below 75% zoom while either end has
 * focus (IR L106: "on hover or focus"). Roving focus doesn't change the selection, so the session can't say.
 * The overlay layer tracks it with one focusin/focusout listener on the sheet (`trackFocusedCard`).
 */
import { useSyncExternalStore } from "react";

let focused: string | null = null;
const listeners = new Set<() => void>();

function set(next: string | null): void {
  if (next === focused) return;
  focused = next;
  for (const listener of Array.from(listeners)) listener();
}

function cardOf(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  return target.closest<HTMLElement>(".react-flow__node[data-id]")?.dataset.id ?? null;
}

/** Follows focus within `root` (the sheet); returns a disposer. */
export function trackFocusedCard(root: HTMLElement): () => void {
  const onIn = (event: FocusEvent) => set(cardOf(event.target));
  const onOut = (event: FocusEvent) => set(root.contains(event.relatedTarget as Node | null) ? cardOf(event.relatedTarget) : null);
  root.addEventListener("focusin", onIn);
  root.addEventListener("focusout", onOut);
  set(cardOf(document.activeElement && root.contains(document.activeElement) ? document.activeElement : null));
  return () => {
    root.removeEventListener("focusin", onIn);
    root.removeEventListener("focusout", onOut);
    set(null);
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Whether keyboard focus is in one of `facets`' cards. */
export function useCardFocused(a: string, b: string): boolean {
  return useSyncExternalStore(subscribe, () => focused === a || focused === b);
}
