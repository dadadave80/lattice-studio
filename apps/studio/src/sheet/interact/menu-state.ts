/**
 * Which context menu is asked for (IR L190-L197): the card's, a pin's or the sheet's, and where. The request is
 * set by the sheet's pointer and key handlers (in the entry) and shown by `SheetMenu` (in the interactions
 * chunk), so nothing heavier than this waits in the entry for a right click.
 */
import type { Hex4 } from "@lattice-studio/core";
import { useSyncExternalStore } from "react";
import type { SheetPoint } from "@/contracts";

export type MenuTarget =
  | { kind: "card"; facet: string }
  | { kind: "pin"; facet: string; selector: Hex4 }
  /** `at`: the sheet point under the pointer, where Add facet here… places. */
  | { kind: "sheet"; at: SheetPoint };

export type MenuRequest = MenuTarget & {
  /** Where the menu opens, in client px: at the pointer, or below the focused element for Shift+F10. */
  client: { x: number; y: number };
  /** What had focus when the menu opened, so focus goes back there when it closes. */
  invoker: HTMLElement | null;
  /** Increases per request, so a second right click reopens the menu at the new place. */
  key: number;
};

let current: MenuRequest | null = null;
let counter = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Opens a context menu for `target` at `client`. */
export function openSheetMenu(target: MenuTarget, client: { x: number; y: number }, invoker: HTMLElement | null): void {
  counter += 1;
  current = { ...target, client, invoker, key: counter };
  emit();
}

/** Closes the context menu, if one is open. */
export function closeSheetMenu(): void {
  if (current === null) return;
  current = null;
  emit();
}

export function sheetMenu(): MenuRequest | null {
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The open context menu's request, re-rendering when it changes. */
export function useSheetMenu(): MenuRequest | null {
  return useSyncExternalStore(subscribe, sheetMenu, sheetMenu);
}
