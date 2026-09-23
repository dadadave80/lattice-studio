import type { DialogId } from "@/contracts";

export type DialogCatalogEntry = {
  /** The dialog's title, as the spec names it. */
  title: string;
  /** The work package that builds it ("S8b"), or "v2" when it isn't in v1. */
  owner: string;
};

/** Every dialog's title and owner: what `DialogHost` shows while an owner hasn't registered its component. */
export const DIALOG_CATALOG: Readonly<Record<DialogId, DialogCatalogEntry>> = {
  "deploy-review": { title: "Deploy review", owner: "S8b" },
  "missing-contracts": { title: "Deploy missing contracts", owner: "S8c" },
  "choose-mechanism": { title: "Choose an upgrade mechanism", owner: "S5d" },
  "choose-per-selector": { title: "Choose per selector", owner: "S4c" },
  "remove-facets": { title: "Remove facets", owner: "S8b" },
  "migrate": { title: "Migrate", owner: "S13" },
  "share": { title: "Share", owner: "S13" },
  "safe-batch": { title: "Safe batch", owner: "S5e" },
  "save-copy": { title: "Save a copy", owner: "S7b" },
  "open-diamond": { title: "Open diamond", owner: "v2" },
  "settings": { title: "Settings", owner: "S10" },
  "delete-for-good": { title: "Delete for good", owner: "S7b" },
  "clear-data": { title: "Clear data", owner: "S7b" },
  "keyboard-shortcuts": { title: "Keyboard shortcuts", owner: "S2" },
  "projects": { title: "Projects", owner: "S7b" },
  "about": { title: "About", owner: "S10" },
  "browse-recipes": { title: "Browse all recipes", owner: "S4d" },
};

/** The placeholder body: "Not built yet · WP-S8b", or "Not in v1." for a v2 dialog. */
export function notBuiltText(id: DialogId): string {
  const { owner } = DIALOG_CATALOG[id];
  return owner === "v2" ? "Not in v1." : `Not built yet · WP-${owner}`;
}
