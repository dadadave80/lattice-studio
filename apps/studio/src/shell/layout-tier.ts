/**
 * The window's layout tier (spec L353-L370): which frame the shell draws. One module-level store, so commands
 * (which run outside React) and components read the same answer.
 *
 * - `wide`, 1280 px and wider: left pane, sheet and inspector side by side.
 * - `mid`, 1024-1279 px: one side pane at a time, as an overlay drawer.
 * - `narrow`, 768-1023 px: both panes are drawers; the console collapses to its summary line.
 * - `phone`, under 768 px (a desktop window at 200-400% zoom too): the pane switcher and the overflow menu.
 *
 * Widths are CSS px (`innerWidth`), so browser zoom moves a window between tiers as the spec asks.
 */
import { useSyncExternalStore } from "react";

export type LayoutTier = "wide" | "mid" | "narrow" | "phone";

/** Where each tier starts, in CSS px. */
export const TIER_MIN = { wide: 1280, mid: 1024, narrow: 768 } as const;

export function tierForWidth(width: number): LayoutTier {
  if (width >= TIER_MIN.wide) return "wide";
  if (width >= TIER_MIN.mid) return "mid";
  if (width >= TIER_MIN.narrow) return "narrow";
  return "phone";
}

/** Whether side panes are overlay drawers at this tier. */
export function isDrawerTier(tier: LayoutTier): tier is "mid" | "narrow" {
  return tier === "mid" || tier === "narrow";
}

type WindowSize = { width: number; height: number };

function readSize(): WindowSize {
  if (typeof window === "undefined") return { width: TIER_MIN.wide, height: 900 };
  return { width: window.innerWidth, height: window.innerHeight };
}

let size: WindowSize = readSize();
const listeners = new Set<() => void>();

function onResize(): void {
  const next = readSize();
  if (next.width === size.width && next.height === size.height) return;
  size = next;
  for (const listener of Array.from(listeners)) listener();
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0 && typeof window !== "undefined") {
    size = readSize();
    window.addEventListener("resize", onResize);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== "undefined") window.removeEventListener("resize", onResize);
  };
}

/** The window's size now, for non-render code. */
export function windowSize(): WindowSize {
  if (listeners.size === 0) size = readSize();
  return size;
}

/** The tier now, for commands and other non-render code. */
export function currentTier(): LayoutTier {
  return tierForWidth(windowSize().width);
}

/** Calls back when the window's size changes (and with it, maybe, the tier). */
export function subscribeWindowSize(listener: () => void): () => void {
  return subscribe(listener);
}

/** The tier, re-rendering when it changes. */
export function useLayoutTier(): LayoutTier {
  return useSyncExternalStore(subscribe, currentTier, () => "wide");
}

/** The window's height in CSS px, re-rendering when it changes (the console's half-height limit). */
export function useWindowHeight(): number {
  return useSyncExternalStore(subscribe, () => windowSize().height, () => 900);
}
