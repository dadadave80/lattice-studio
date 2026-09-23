import type { Address, Hex4 } from "@lattice-studio/core";
import type { ComponentType } from "react";

/**
 * Dialogs (contracts §5.2 "dialogs"): every dialog of IR L170-L188, plus Projects, About, Browse all recipes
 * and the deploy review's missing-contracts sub-step. `openDialog(id, props)` pushes onto the session's
 * dialog stack; each dialog's owner registers the component that renders it with `registerDialog`. S0's host
 * renders the whole stack, bottom first, so a dialog opened from another (Clear data over Settings, missing
 * contracts over the deploy review) keeps the one below mounted; only the top is interactive.
 */
export const DIALOG_IDS = [
  "deploy-review", "missing-contracts", "choose-mechanism", "choose-per-selector", "remove-facets", "migrate",
  "share", "safe-batch", "save-copy", "open-diamond", "settings", "delete-for-good", "clear-data",
  "keyboard-shortcuts", "projects", "about", "browse-recipes",
] as const;

export type DialogId = (typeof DIALOG_IDS)[number];

/** Settings groups (spec L628-L640). */
export type SettingsGroup = "appearance" | "canvas" | "keyboard" | "networks" | "wallet" | "deploy" | "data" | "about";

/** Each dialog's props. Optional fields default as each owner documents. */
export type DialogPropsMap = {
  /** S8b · Deploy review (Deploy…, ⌘Enter). `at: "progress"` reopens at the deploy's progress (deploy.showProgress, IR L207). */
  "deploy-review": { at?: "review" | "progress"; chainId?: number };
  /** S8c · Deploy missing contracts… (opens from the review's Network section when NET-03 fires). */
  "missing-contracts": { chainId: number; names?: string[] };
  /** S5d · Choose an upgrade mechanism (CORE-02, AUTH-01, Flow 17). */
  "choose-mechanism": { preset?: "safe" | "governance" };
  /** S4c · Choose per selector (a collision note). */
  "choose-per-selector": { selectors: Hex4[] };
  /** S8b · Remove facets (NET-06). */
  "remove-facets": { chainId?: number };
  /** S13 · Migrate to another catalog (the read-only banner, an old project or link). */
  "migrate": { target?: string };
  /** S13 · Share, over 2,000 characters. */
  "share": { link: string };
  /** S5e · Safe batch (Export menu). */
  "safe-batch": { safe?: Address; chainId?: number };
  /** S7b · Save a copy (⌘S with no linked file). */
  "save-copy": { filename?: string };
  /** v2 · Open diamond (App menu). */
  "open-diamond": { address?: Address; chainId?: number };
  /** S10 · Settings. */
  "settings": { group?: SettingsGroup };
  /** S7b · Delete for good (Recently deleted). */
  "delete-for-good": { projectId: string };
  /** S7b · Clear data (Settings → Data). */
  "clear-data": Record<string, never>;
  /** S2 · Keyboard shortcuts (?, App menu). */
  "keyboard-shortcuts": { query?: string };
  /** S7b · Projects (App menu). */
  "projects": { tab?: "recent" | "deleted" };
  /** S10 · About. */
  "about": Record<string, never>;
  /** S4d · Browse all recipes (Start a diamond, recipe.browse), with the v1.1 and factory notes. */
  "browse-recipes": { query?: string };
};

export type DialogProps<I extends DialogId = DialogId> = DialogPropsMap[I];

/** One open dialog. `key` is unique per opening, so reopening the same id remounts it. */
export type DialogEntry<I extends DialogId = DialogId> = {
  [K in I]: { id: K; props: DialogPropsMap[K]; key: number };
}[I];

/** What a registered dialog component receives. */
export type DialogComponentProps<I extends DialogId = DialogId> = {
  entry: DialogEntry<I>;
  /** True for the top of the stack; the ones below stay mounted but inert. */
  top: boolean;
};

const components = new Map<DialogId, ComponentType<DialogComponentProps<never>>>();

/**
 * The dialog's owner registers the component that renders it (wrap it in `React.lazy` to keep it in its own
 * chunk). Throws when the id already has one. Returns a disposer.
 */
export function registerDialog<I extends DialogId>(id: I, component: ComponentType<DialogComponentProps<I>>): () => void {
  if (components.has(id)) throw new Error(`Dialog ${id} already has a component.`);
  const stored = component as unknown as ComponentType<DialogComponentProps<never>>;
  components.set(id, stored);
  return () => {
    if (components.get(id) === stored) components.delete(id);
  };
}

/** The component registered for `id`, or null while its owner hasn't landed. */
export function dialogComponent<I extends DialogId>(id: I): ComponentType<DialogComponentProps<I>> | null {
  return (components.get(id) as ComponentType<DialogComponentProps<I>> | undefined) ?? null;
}
