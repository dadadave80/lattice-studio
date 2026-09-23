import type { Platform } from "@lattice-studio/core";
import { useSyncExternalStore } from "react";

type NavigatorLike = { platform?: string; userAgentData?: { platform?: string } };

/**
 * Key labels follow the platform: ⌘C on macOS, Ctrl+C on Windows and Linux (spec L689). iPadOS and iOS
 * count as macOS: their hardware keyboards carry ⌘.
 */
export function detectPlatform(nav: NavigatorLike | undefined): Platform {
  const name = nav?.userAgentData?.platform || nav?.platform || "";
  return /mac|iphone|ipad|ipod/i.test(name) ? "mac" : "other";
}

let override: Platform | null = null;
const listeners = new Set<() => void>();

function current(): Platform {
  if (override) return override;
  return typeof navigator === "undefined" ? "other" : detectPlatform(navigator as Navigator & NavigatorLike);
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/** The platform key labels follow, outside React. */
export function platform(): Platform {
  return current();
}

/** The platform key labels follow; re-renders when a test or the gallery pins another. */
export function usePlatform(): Platform {
  return useSyncExternalStore(subscribe, current, current);
}

/** @internal Pins the platform (tests, the gallery). Returns a disposer that restores detection. */
export function overridePlatform(next: Platform): () => void {
  const previous = override;
  override = next;
  for (const fn of listeners) fn();
  return () => {
    override = previous;
    for (const fn of listeners) fn();
  };
}
