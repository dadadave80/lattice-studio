/** Popup implementations load on first render; tooltip triggers stay mounted to preserve edits and gestures. */
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
