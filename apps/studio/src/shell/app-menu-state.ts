/**
 * The App menu's open state, shared by the title bar's menu and the `app.menu` command (which runs outside
 * React). `mounted` counts the menus on screen, so the command can say when there's none to open.
 */
import { useSyncExternalStore } from "react";

let open = false;
let mounted = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of Array.from(listeners)) listener();
}

export function setAppMenuOpen(next: boolean): void {
  if (open === next) return;
  open = next;
  emit();
}

export function appMenuOpen(): boolean {
  return open;
}

/** Whether an App menu is on screen to open. */
export function appMenuMounted(): boolean {
  return mounted > 0;
}

/** Registers a mounted App menu; returns the disposer for its unmount. */
export function retainAppMenu(): () => void {
  mounted += 1;
  return () => {
    mounted -= 1;
    if (mounted === 0) setAppMenuOpen(false);
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function useAppMenuOpen(): boolean {
  return useSyncExternalStore(subscribe, appMenuOpen, () => false);
}
