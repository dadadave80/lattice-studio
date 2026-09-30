/**
 * The title block's size on the sheet, published by its layer while it shows, so the core cell can sit
 * immediately left of it (its Panel shares the bottom-right corner). Null while no title block is drawn (the
 * phone tier, or before the chrome's chunk lands): the cell then sits in the corner itself.
 */
import type { Size } from "@lattice-studio/core";
import { useSyncExternalStore } from "react";

let size: Size | null = null;
const listeners = new Set<() => void>();

function same(a: Size | null, b: Size | null): boolean {
  return a === b || (a !== null && b !== null && a.width === b.width && a.height === b.height);
}

/** The title block's layer says how big it is now (null when it leaves). */
export function publishTitleBlockSize(next: Size | null): void {
  if (same(size, next)) return;
  size = next;
  for (const listener of Array.from(listeners)) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The title block's size, re-rendering when it changes. */
export function useTitleBlockSize(): Size | null {
  return useSyncExternalStore(subscribe, () => size, () => null);
}

/** The title block's size now, for non-render code. */
export function titleBlockSize(): Size | null {
  return size;
}
