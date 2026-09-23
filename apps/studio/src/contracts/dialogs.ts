import type { ComponentType } from "react";

/**
 * Dialog ids (contracts §5.2 "dialogs"): every dialog of IR L170-L188, plus the Projects list and About.
 * `openDialog(id, props)` pushes onto the session's dialog stack; the dialog's owner registers the component
 * that renders it with `registerDialog`, and S0's host renders the top of the stack.
 */
export const DIALOG_IDS = [
  /** S8b · Deploy review (Deploy…, ⌘Enter). */
  "deploy-review",
  /** S5d · Choose an upgrade mechanism (CORE-02, AUTH-01, Flow 17). */
  "choose-mechanism",
  /** S4c · Choose per selector (a collision note). */
  "choose-per-selector",
  /** S8b · Remove facets (NET-06). */
  "remove-facets",
  /** S13 · Migrate (the read-only banner, an old project or link). */
  "migrate",
  /** S13 · Share, over 2,000 characters. */
  "share",
  /** S5e · Safe batch (Export menu). */
  "safe-batch",
  /** S7b · Save a copy (⌘S with no linked file). */
  "save-copy",
  /** v2 · Open diamond (App menu). */
  "open-diamond",
  /** S10 · Settings. */
  "settings",
  /** S7b · Delete for good (Recently deleted). */
  "delete-for-good",
  /** S7b · Clear data (Settings → Data). */
  "clear-data",
  /** S2 · Keyboard shortcuts (?, App menu). */
  "keyboard-shortcuts",
  /** S7b · Projects (App menu). */
  "projects",
  /** S10 · About. */
  "about",
] as const;

export type DialogId = (typeof DIALOG_IDS)[number];

/** What a dialog receives; each owner validates its own props. */
export type DialogProps = Readonly<Record<string, unknown>>;

/** One open dialog. `key` is unique per opening, so reopening the same id remounts it. */
export type DialogEntry = { id: DialogId; props: DialogProps; key: number };

/** What a registered dialog component receives. */
export type DialogComponentProps = { entry: DialogEntry };

const components = new Map<DialogId, ComponentType<DialogComponentProps>>();

/**
 * The dialog's owner registers the component that renders it (wrap it in `React.lazy` to keep it in its own
 * chunk). Throws when the id already has one. Returns a disposer.
 */
export function registerDialog(id: DialogId, component: ComponentType<DialogComponentProps>): () => void {
  if (components.has(id)) throw new Error(`Dialog ${id} already has a component.`);
  components.set(id, component);
  return () => {
    if (components.get(id) === component) components.delete(id);
  };
}

/** The component registered for `id`, or null while its owner hasn't landed. */
export function dialogComponent(id: DialogId): ComponentType<DialogComponentProps> | null {
  return components.get(id) ?? null;
}
