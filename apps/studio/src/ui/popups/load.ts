/**
 * Base UI's popups (menus, context menus, tooltips) load in their own chunk, asked for as soon as the first one
 * renders (spec L822, Q19): Base UI's popup parts and Floating UI, about 40 KB gz that nothing needs before a
 * person hovers, focuses or opens something. `ui/overlays` and `ui/tooltip` keep their components' names and
 * props and render through here: until the chunk arrives a menu, context menu or tooltip renders its trigger
 * alone, as it is, and then the real one. The trigger elements are re-created then, so the one that had focus
 * hands it to the element that took its place.
 */
import { useSyncExternalStore } from "react";
import { flushSync } from "react-dom";

export type Popups = typeof import("./popups");

let popups: Popups | null = null;
let loading: Promise<Popups> | null = null;
const listeners = new Set<() => void>();

/** What can hold focus, leaving out Base UI's focus guards (hidden spans its portals add around a popup). */
const FOCUSABLE = "a[href], button, input, select, textarea, [tabindex]:not([data-base-ui-focus-guard])";

function arrive(kit: Popups): void {
  const active = document.activeElement;
  const before = active && active !== document.body ? Array.from(document.querySelectorAll(FOCUSABLE)) : [];
  const at = active ? before.indexOf(active) : -1;
  flushSync(() => {
    popups = kit;
    for (const listener of Array.from(listeners)) listener();
  });
  // Only when focus went with its element: a menu opened early has taken it into its popup.
  const lost = document.activeElement === null || document.activeElement === document.body;
  if (at >= 0 && active && !active.isConnected && lost) {
    document.querySelectorAll<HTMLElement>(FOCUSABLE)[at]?.focus({ preventScroll: true });
  }
}

/** The popups, loading them the first time. */
export function loadPopups(): Promise<Popups> {
  if (popups) return Promise.resolve(popups);
  loading ??= import("./popups").then(
    (kit) => {
      arrive(kit);
      return kit;
    },
    (error: unknown) => {
      // A chunk that failed to load can be asked for again (the PWA's chunk-error watcher offers a reload).
      loading = null;
      throw error;
    },
  );
  return loading;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  void loadPopups().catch(() => undefined);
  return () => {
    listeners.delete(listener);
  };
}

/** The popups once they've loaded, else null; asks for them on first use. */
export function usePopups(): Popups | null {
  return useSyncExternalStore(subscribe, () => popups, () => null);
}
