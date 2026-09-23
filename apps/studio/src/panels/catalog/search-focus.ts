/**
 * A tiny seam between `catalog.focusSearch` (the "/" shortcut, IR L82) and whichever `CatalogPanel` instance
 * is mounted: the panel registers its search input while it's on screen, and the command (run from the
 * palette, the console or, once S2 lands, the global keymap) just calls it. `CatalogPanel` also listens for
 * "/" itself, in a capture handler on its own root, so the shortcut works today without S2's key router.
 */
let handler: (() => void) | null = null;

/** Called by `CatalogPanel` on mount; null on unmount. */
export function registerSearchFocus(next: (() => void) | null): void {
  handler = next;
}

/** Runs the registered handler. Returns whether one was registered. */
export function focusCatalogSearch(): boolean {
  if (!handler) return false;
  handler();
  return true;
}

/** @internal Tests: whether a panel is currently registered. */
export function hasSearchFocus(): boolean {
  return handler !== null;
}
