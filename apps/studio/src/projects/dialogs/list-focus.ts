/**
 * Where focus goes after a row leaves a Projects-dialog list: the list itself (spec's focus-return rules,
 * PA #15), never the body. `ProjectsDialogPanel` registers each list's container while it's open; a row
 * (or a dialog opened from one, like Delete for good) calls `focusList` once the row it acted on is gone.
 */
export type ListKind = "recent" | "deleted";

const targets = new Map<ListKind, () => void>();

/** Registers `kind`'s focus target. Returns a disposer, so it clears when the dialog closes. */
export function registerListFocus(kind: ListKind, focus: () => void): () => void {
  targets.set(kind, focus);
  return () => {
    if (targets.get(kind) === focus) targets.delete(kind);
  };
}

/** Moves focus to `kind`'s list container, if the Projects dialog is open and has one registered. */
export function focusList(kind: ListKind): void {
  targets.get(kind)?.();
}
