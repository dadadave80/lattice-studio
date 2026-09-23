type KeyLike = Pick<KeyboardEvent, "key" | "shiftKey" | "ctrlKey" | "altKey" | "metaKey">;

/** Shift+F10 or the Menu key: the platform's keyboard path to a context menu. */
export function isContextMenuKey(event: KeyLike): boolean {
  if (event.key === "ContextMenu") return true;
  return event.key === "F10" && event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey;
}
