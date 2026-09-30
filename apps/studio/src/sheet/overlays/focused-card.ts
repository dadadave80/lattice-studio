/**
 * The card keyboard focus is in, for the traces: a trace's reason shows below 75% zoom while either end has
 * focus (IR L106: "on hover or focus"), and the core draws a focused card's trace into the diamond. Roving focus
 * doesn't change the selection, so the session can't say. One focusin/focusout listener on the sheet
 * (`trackFocusedCard`), shared by every layer that asks: the first caller installs it, the last one removes it.
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

let tracked: { root: HTMLElement; count: number; stop: () => void } | null = null;

function install(root: HTMLElement): () => void {
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

/** Follows focus within `root` (the sheet) while any caller holds it; returns a disposer. */
export function trackFocusedCard(root: HTMLElement): () => void {
  if (tracked && tracked.root !== root) {
    // Another sheet: the old one is gone (a test rendered a new sheet); its listeners go with it.
    tracked.stop();
    tracked = null;
  }
  if (tracked) tracked.count += 1;
  else tracked = { root, count: 1, stop: install(root) };
  let held = true;
  return () => {
    if (!held || !tracked || tracked.root !== root) return;
    held = false;
    tracked.count -= 1;
    if (tracked.count === 0) {
      tracked.stop();
      tracked = null;
    }
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

/** The card keyboard focus is in (the card itself or one of its rows), or null. */
export function useFocusedCard(): string | null {
  return useSyncExternalStore(subscribe, () => focused, () => null);
}
